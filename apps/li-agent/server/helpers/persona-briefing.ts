import { completeText, runWithRequestContext } from "@agent-native/core/server";
import { createHash } from "node:crypto";
import { getOwnerCtx } from "./get-owner-ctx.js";
import { NO_EM_DASH_RULE, stripEmDashes } from "./style-rules.js";

/**
 * A structured read of one persona, derived from that persona's ICP documents:
 * who to reach out to, how to speak to them, why they buy, and what they care
 * about at an organizational level.
 *
 * This is a READ of the ICP, not a second source of truth. Nothing scores or
 * drafts from it -- selectPersona computes criteria text fresh from the
 * shared persona's documents (getPersonaCriteriaText) and passes that to
 * draftProfile. If this and the documents ever disagree, the documents win, which
 * is why the briefing carries the hash of the text it came from (see
 * hashIcpText) and the UI marks it stale rather than quietly serving a
 * briefing that no longer matches the uploaded criteria.
 */
export interface PersonaBriefing {
  /** Two or three sentences: who this persona is and where they sit. */
  positioning: string;
  /** Titles worth reaching out to first, verbatim from the ICP where possible. */
  titles: string[];
  /**
   * The next tier down, used when an account has none of the primary titles.
   * Separate from `titles` because ICP filter blocks routinely rank seniority
   * ("VP and Head first, Director as the fallback") and flattening that into
   * one list loses the instruction -- the previous version smuggled it into
   * the title text as a "(fallback)" suffix, which is not something a rep can
   * filter or search on.
   */
  fallbackTitles: string[];
  /** Titles that look adjacent but are the wrong buyer. */
  avoidTitles: string[];
  /**
   * The same wrong-buyer roles as `avoidTitles`, but as a flat list of
   * literal, individual job titles -- no grouping ("A / B / C"), no
   * parenthetical examples or industry-term lists, one real title a
   * LinkedIn profile could actually show per entry. `avoidTitles` is
   * grouped and readable on purpose for the briefing sheet (a rep reading
   * "Hardware / Physical Design roles (ASIC, Silicon, Chip, ...)" gets the
   * shape of the exclusion at a glance); this field exists because that
   * same grouped string is not a valid search filter value -- it was
   * getting pasted verbatim into a LinkedIn "Current job title" exclude
   * filter as one literal (and useless) entry. This is the only form
   * generate-sales-nav-search.ts should read for exclusion.
   */
  avoidTitlesSearch: string[];
  /** What this persona is measured on / cares about org-wide. */
  orgPriorities: string[];
  /** What makes them actually buy, and the triggers that start it. */
  whyTheyBuy: string[];
  /** The problems they feel day to day. */
  painPoints: string[];
  /** How to speak to them. */
  voice: { tone: string; dos: string[]; donts: string[] };
  /** Concrete angles to open a conversation on. */
  openingAngles: string[];
  /**
   * What the uploaded documents DON'T say. Load-bearing: it gives the model
   * somewhere honest to put a gap, instead of inventing a plausible answer to
   * fill a section. An empty briefing section plus a named gap is the correct
   * output for a thin ICP document.
   */
  coverageGaps: string[];
}

// Chars of persona icpText fed to the briefing prompt. Deliberately large:
// a briefing is generated once, on demand, and wants the WHOLE ICP. At the
// previous 12k a real persona (three documents, with the boolean Job Title
// Include/Exclude filter blocks near the end) had its entire title list
// truncated away before the model ever saw it, so the briefing paraphrased
// titles from the prose intro instead of extracting the ones the ICP
// actually specifies.
const MAX_ICP_CHARS = 60_000;

// Prose sections stay tight; title lists do not. A boolean include block of
// (5 seniority terms) AND (13 function terms) expands well past 8 real
// titles, and truncating it silently drops targets a rep is supposed to be
// prospecting into.
const MAX_ITEMS = 8;
const MAX_TITLE_ITEMS = 30;
const MAX_ITEM_CHARS = 240;

/**
 * Bump when a change to the prompt or the briefing shape means previously
 * generated briefings are worse than what regenerating would produce. It is
 * mixed into the fingerprint below, so every stored briefing immediately reads
 * as out of date and the UI offers a refresh, instead of the improvement only
 * reaching personas whose documents happen to change later.
 *
 * v2: title extraction reads the ICP's explicit Job Title Include/Exclude
 * filter blocks and expands boolean cross products; primary and fallback
 * seniority tiers separated; ICP window raised past the point where those
 * filter blocks were being truncated away entirely.
 *
 * v3: added avoidTitlesSearch, a flat/literal companion to avoidTitles for
 * feeding a real LinkedIn exclude filter -- avoidTitles' grouped strings
 * (slashes, "or", parenthetical examples) were being used as literal filter
 * values by generate-sales-nav-search.ts and produced nonsense chips.
 */
const BRIEFING_PROMPT_VERSION = "v3";

/**
 * Fingerprint of the ICP text a briefing was generated from, stored alongside
 * it so a briefing can be shown as stale once documents are added or removed.
 * Truncated to 16 hex chars: this is change detection, not security.
 */
export function hashIcpText(icpText: string): string {
  return createHash("sha256")
    .update(`${BRIEFING_PROMPT_VERSION}\n${icpText}`)
    .digest("hex")
    .slice(0, 16);
}

function cleanLine(value: unknown): string {
  return stripEmDashes(String(value ?? "").trim()).slice(0, MAX_ITEM_CHARS);
}

function cleanList(value: unknown, max = MAX_ITEMS): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const line = cleanLine(raw);
    if (!line) continue;
    // Expanding a boolean cross product reliably produces repeats ("Head of
    // Design" from two branches). Duplicates also collide as React keys in
    // the briefing sheet, so dedupe here rather than at render.
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= max) break;
  }
  return out;
}

const BRIEFING_SHAPE = `{
  "positioning": "<2-3 sentences: who this persona is, seniority, where they sit in the org>",
  "titles": ["<every primary job title to target, verbatim from the documents>"],
  "fallbackTitles": ["<titles to use only when an account has none of the primary titles>"],
  "avoidTitles": ["<titles and role types the documents exclude>"],
  "avoidTitlesSearch": ["<the same excluded roles, flattened into individual literal job titles -- no grouping, no parentheses>"],
  "orgPriorities": ["<what this persona is measured on and cares about at an organizational level>"],
  "whyTheyBuy": ["<what makes them buy, and the trigger that starts it>"],
  "painPoints": ["<problems they feel day to day>"],
  "voice": {
    "tone": "<one sentence on how to speak to them>",
    "dos": ["<specific things to do in outreach to this persona>"],
    "donts": ["<specific things to avoid saying to this persona>"]
  },
  "openingAngles": ["<concrete angles to open a conversation on>"],
  "coverageGaps": ["<anything a rep would need that the documents do not cover>"]
}`;

/**
 * Generate a briefing for one persona from its ICP text.
 *
 * Returns null when there's nothing to read (no documents attached) -- the
 * caller surfaces that rather than getting an invented briefing. Throws on a
 * genuine model/parse failure so the action can report it, rather than
 * persisting a half-empty briefing that looks generated.
 */
export async function buildPersonaBriefing({
  personaName,
  icpText,
}: {
  personaName: string;
  icpText: string | null;
}): Promise<PersonaBriefing | null> {
  if (!icpText?.trim()) return null;

  const ownerCtx = await getOwnerCtx();

  const systemPrompt =
    "You are a B2B sales strategist. You are given the ICP criteria documents for ONE buyer persona. " +
    "Turn them into a practical briefing a sales rep can act on before reaching out.\n\n" +
    `${NO_EM_DASH_RULE}\n\n` +
    "Rules:\n" +
    "- Derive everything from the documents provided. Do not invent industry knowledge, " +
    "company names, metrics, or buying triggers that the documents do not support.\n" +
    "- If the documents do not cover one of the sections, return an EMPTY array for it and " +
    'name the gap in "coverageGaps". An empty section plus a named gap is correct and useful. ' +
    "A plausible-sounding guess is not.\n" +
    "- Be specific and concrete. Prefer the document's own words for titles and criteria over paraphrase.\n" +
    "- Keep every list item to one short line.\n\n" +
    // The single biggest quality problem in practice: these documents carry an
    // explicit, authoritative title list (often as a Sales Navigator boolean
    // filter block), and the model would summarize the prose intro instead of
    // reading it -- returning a handful of plausible titles while ignoring the
    // list the team actually prospects by.
    "TITLES -- read this carefully:\n" +
    "- The documents may contain an explicit title list: a section like \"Job Title (Include)\", " +
    '"Job Title (Exclude)", "Titles", "Personas", or a boolean search string. That list is ' +
    "AUTHORITATIVE. Extract from it. Do not substitute titles you infer from the prose.\n" +
    "- Expand a boolean cross product into real titles. Given " +
    '("VP" OR "Head") AND ("Product Design" OR "Design Systems"), return "VP of Product Design", ' +
    '"VP of Design Systems", "Head of Product Design", "Head of Design Systems" -- not a summary ' +
    "of the pattern. Cover every seniority term against every function term. Be exhaustive: " +
    "a long, complete title list is correct and expected here.\n" +
    "- Use the document's own seniority and function wording. Do not invent a title whose terms " +
    "do not appear in the documents.\n" +
    '- If the documents rank seniority (for example "VP and Head first, Director is the fallback", ' +
    'or a "Prioritize within results" note), put the top tier in "titles" and the lower tier in ' +
    '"fallbackTitles". Never encode that ranking as text inside a title.\n' +
    '- Put excluded titles in "avoidTitles". An exclude block mixing role types with industry ' +
    "terms (hardware, silicon, brand, gaming) should come back as the role types a rep would " +
    "actually mistake for a match, grouped where the raw terms are not titles on their own.\n" +
    '- Also fill "avoidTitlesSearch" with the SAME excluded roles, but as a FLAT list of literal, ' +
    "individual job titles -- one real title per entry, no grouping. This feeds a real LinkedIn " +
    'search filter, so a grouped string like "Creative Director / Brand Designer / Art Director" is ' +
    'useless there and MUST become three separate entries: "Creative Director", "Brand Designer", ' +
    '"Art Director". Expand a parenthetical example list the same way a person\'s title would read: ' +
    '"Design IC (e.g. Staff Product Designer, Senior Product Designer)" becomes "Staff Product ' +
    'Designer" and "Senior Product Designer" -- drop the category label itself ("Design IC") since ' +
    "that is not a title anyone actually holds. When the source is bare industry/domain terms rather " +
    'than titles, e.g. "Hardware / Physical Design roles (ASIC, Silicon, Chip, Semiconductor, ...)", ' +
    "turn each into a real title a LinkedIn profile could show (\"ASIC Designer\", \"Hardware Design " +
    'Engineer\", "Chip Design Engineer"), not the bare term alone. Never put a comma/slash-joined or ' +
    "parenthetical string into this array as a single entry.\n" +
    "- If the documents contain no explicit title list, derive titles from the prose and say so " +
    'in "coverageGaps".\n\n' +
    `Reply with valid JSON only, in exactly this shape:\n${BRIEFING_SHAPE}`;

  // If the ICP genuinely exceeds the window, say so in the input rather than
  // truncating silently -- a briefing built from a cut-off document should
  // admit the gap instead of looking complete.
  const truncated = icpText.length > MAX_ICP_CHARS;
  const documentBlock = truncated
    ? `${icpText.slice(0, MAX_ICP_CHARS)}\n\n[The documents were truncated here because of length. ` +
      `Note this under coverageGaps so the rep knows the briefing may not cover everything.]`
    : icpText;

  // A real persona ICP (multiple documents, an exhaustive boolean title
  // expansion per the TITLES instructions above, plus 8 prose sections) can
  // still run past 4000 output tokens and get cut off mid-JSON -- that used
  // to be a hard failure with no retry. completeText's stopReason tells us
  // definitively when that happened (as opposed to a genuine malformed
  // response), so retry once with a stricter size instruction instead of
  // making the user press the button again themselves.
  async function attempt(constrained: boolean) {
    const call = () =>
      completeText({
        systemPrompt: constrained
          ? `${systemPrompt}\n\nIMPORTANT: your previous response was cut off for being too long. ` +
            "This time, cap every list (including titles/fallbackTitles/avoidTitles/avoidTitlesSearch) " +
            "at 15 items and keep every line short. A shorter complete briefing is far more useful than " +
            "a longer one that gets cut off."
          : systemPrompt,
        input: `Persona name: ${personaName}\n\nICP documents:\n${documentBlock}`,
        maxOutputTokens: 8000,
      });
    return ownerCtx ? await runWithRequestContext(ownerCtx, call) : await call();
  }

  let result = await attempt(false);
  let raw = result.text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  let parsed: Record<string, any> | undefined;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }

  if (!parsed && result.stopReason === "max_tokens") {
    result = await attempt(true);
    raw = result.text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
  }

  if (!parsed) {
    throw new Error("The model did not return a usable briefing. Try generating it again.");
  }

  const voice = (parsed.voice ?? {}) as Record<string, unknown>;
  const briefing: PersonaBriefing = {
    positioning: cleanLine(parsed.positioning).slice(0, 600),
    titles: cleanList(parsed.titles, MAX_TITLE_ITEMS),
    fallbackTitles: cleanList(parsed.fallbackTitles, MAX_TITLE_ITEMS),
    avoidTitles: cleanList(parsed.avoidTitles, MAX_TITLE_ITEMS),
    avoidTitlesSearch: cleanList(parsed.avoidTitlesSearch, MAX_TITLE_ITEMS),
    orgPriorities: cleanList(parsed.orgPriorities),
    whyTheyBuy: cleanList(parsed.whyTheyBuy),
    painPoints: cleanList(parsed.painPoints),
    voice: {
      tone: cleanLine(voice.tone),
      dos: cleanList(voice.dos),
      donts: cleanList(voice.donts),
    },
    openingAngles: cleanList(parsed.openingAngles),
    coverageGaps: cleanList(parsed.coverageGaps),
  };

  // A response that parsed as JSON but carries no actual content is a failure,
  // not a briefing -- don't persist it over whatever the persona had before.
  const hasContent =
    briefing.positioning.length > 0 ||
    briefing.titles.length > 0 ||
    briefing.fallbackTitles.length > 0 ||
    briefing.whyTheyBuy.length > 0 ||
    briefing.orgPriorities.length > 0;
  if (!hasContent) {
    throw new Error("The model returned an empty briefing. Try generating it again.");
  }

  return briefing;
}
