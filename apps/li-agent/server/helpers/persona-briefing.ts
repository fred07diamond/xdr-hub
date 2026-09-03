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

// Why this is TWO parallel model calls instead of one.
//
// completeText() has NO default internal timeout (confirmed against
// @agent-native/core's own source), and this runs inside one synchronous,
// non-streaming HTTP response: the client sees zero bytes until
// buildPersonaBriefing fully resolves. So an over-long generation here does
// not surface as a normal error -- it surfaces as an "Inactivity Timeout"
// proxy page and a button that looks like it did nothing.
//
// The wall is ~40s, not 60s. @agent-native/core's own
// docs/design/durable-agent-runs.md pins DEFAULT_HOSTED_RUN_SOFT_TIMEOUT_MS
// at 40_000 and describes it as sitting "just under a stack of upstream
// walls that the framework does not control" -- the observed 60,000ms
// Lambda hard-kill (an uncaught ECONNRESET/"socket hang up", no response at
// all) is only the outermost of those, and the corporate proxy in front of
// it gives up sooner still. Core's durable 15-minute background runs are
// flagged off by default and scoped to agent-chat runs, not app helpers, so
// there is no supported way to simply run longer here.
//
// A single call could not fit under that wall for a real persona. Asking one
// call for an exhaustive boolean title expansion (see the TITLES rules
// below) AND eight prose sections routinely hit the 8000-token cap, which
// then fired the truncation retry -- a SECOND full-size call -- so the
// failing case was ~2x an already-too-slow generation. Splitting the two
// halves and running them concurrently makes total wall-clock the slower of
// the two rather than their sum, keeps each one's output far enough under
// the cap that the retry effectively stops firing, and costs no briefing
// quality: each call gets a smaller, more focused instruction set than the
// combined prompt gave either half.
const PHASE_TIMEOUT_MS = 20_000;
const RETRY_ATTEMPT_TIMEOUT_MS = 12_000;

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
 *
 * v4: titles and prose are generated by two separate concurrent calls (see
 * the timeout comment above). Briefings generated before this are worth
 * regenerating: the single combined call they came from was frequently
 * truncated at the token cap, so their later sections (voice, openingAngles,
 * coverageGaps) are the ones most likely to have been cut short or dropped.
 */
const BRIEFING_PROMPT_VERSION = "v4";

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

// The two response shapes, one per concurrent call. Between them they cover
// exactly the PersonaBriefing fields above, with no overlap -- mergeBriefing
// below assembles one briefing from both.
const TITLES_SHAPE = `{
  "titles": ["<every primary job title to target, verbatim from the documents>"],
  "fallbackTitles": ["<titles to use only when an account has none of the primary titles>"],
  "avoidTitles": ["<titles and role types the documents exclude>"],
  "avoidTitlesSearch": ["<the same excluded roles, flattened into individual literal job titles -- no grouping, no parentheses>"],
  "coverageGaps": ["<anything about WHO TO TARGET that the documents do not cover>"]
}`;

const PROSE_SHAPE = `{
  "positioning": "<2-3 sentences: who this persona is, seniority, where they sit in the org>",
  "orgPriorities": ["<what this persona is measured on and cares about at an organizational level>"],
  "whyTheyBuy": ["<what makes them buy, and the trigger that starts it>"],
  "painPoints": ["<problems they feel day to day>"],
  "voice": {
    "tone": "<one sentence on how to speak to them>",
    "dos": ["<specific things to do in outreach to this persona>"],
    "donts": ["<specific things to avoid saying to this persona>"]
  },
  "openingAngles": ["<concrete angles to open a conversation on>"],
  "coverageGaps": ["<anything a rep would need for MESSAGING that the documents do not cover>"]
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

  // Shared by both phases below, so neither can drift from the other on the
  // ground rules (no invention, name the gap instead of guessing, one short
  // line per item).
  const sharedRules =
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
    "- Keep every list item to one short line.\n\n";

  // Phase 1: WHO to target. This half is the one that legitimately needs a
  // lot of output tokens (an exhaustive boolean cross-product expansion), and
  // it is the half other code actually consumes -- generate-sales-nav-search.ts
  // reads avoidTitlesSearch -- so it gets its own call rather than competing
  // for the same token budget as the prose sections.
  const titlesSystemPrompt =
    sharedRules +
    "Your ONLY job in this response is WHO TO TARGET: the job titles. Do not produce positioning, " +
    "messaging, pain points, or voice guidance -- a separate pass handles those.\n\n" +
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
    `Reply with valid JSON only, in exactly this shape:\n${TITLES_SHAPE}`;

  // Phase 2: HOW to speak to them. Runs concurrently with phase 1 above.
  const proseSystemPrompt =
    sharedRules +
    "Your ONLY job in this response is the MESSAGING read: positioning, what this persona is " +
    "measured on, why they buy, what hurts day to day, how to speak to them, and concrete opening " +
    "angles. A separate pass handles the job-title lists, so do NOT return titles here -- if the " +
    "documents' most useful messaging signal is a title list, summarize what it implies about the " +
    "buyer rather than restating the titles.\n\n" +
    "- Ground voice/dos/donts in what the documents actually say about this buyer, not generic " +
    "B2B outreach advice. If the documents say nothing about tone, leave it empty and name that " +
    'in "coverageGaps" rather than inventing a house style.\n' +
    "- An opening angle should be something specific a rep could actually reference, not a topic " +
    "label.\n\n" +
    `Reply with valid JSON only, in exactly this shape:\n${PROSE_SHAPE}`;

  // If the ICP genuinely exceeds the window, say so in the input rather than
  // truncating silently -- a briefing built from a cut-off document should
  // admit the gap instead of looking complete.
  const truncated = icpText.length > MAX_ICP_CHARS;
  const documentBlock = truncated
    ? `${icpText.slice(0, MAX_ICP_CHARS)}\n\n[The documents were truncated here because of length. ` +
      `Note this under coverageGaps so the rep knows the briefing may not cover everything.]`
    : icpText;

  const input = `Persona name: ${personaName}\n\nICP documents:\n${documentBlock}`;

  // Per-phase output cap. Deliberately well below the 8000 the single
  // combined call used: each half's realistic output (4 title lists, or 8
  // prose sections) fits inside this with room to spare, so hitting the cap
  // -- and paying for the truncation retry below -- becomes the rare
  // exception rather than the normal path for a large persona.
  const PHASE_MAX_OUTPUT_TOKENS = 4000;

  function parseJsonResponse(text: string): Record<string, any> | undefined {
    const raw = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  // One phase = one focused call, plus the existing truncation retry.
  // completeText's stopReason tells us definitively when a response was cut
  // off at the cap (as opposed to a genuinely malformed one), so that case
  // retries once with a stricter size instruction instead of making the user
  // press the button again themselves.
  //
  // Returns undefined instead of throwing: with two phases in flight, one
  // failing half should not discard the other half's real work (see the
  // merge below), and a phase that fails for a caller-visible reason still
  // needs to be reported as a named gap rather than a silent empty section.
  async function runPhase(phaseSystemPrompt: string, retryHint: string) {
    async function attempt(constrained: boolean) {
      const call = () =>
        completeText({
          systemPrompt: constrained
            ? `${phaseSystemPrompt}\n\nIMPORTANT: your previous response was cut off for being too long. ` +
              `${retryHint} A shorter complete response is far more useful than a longer one that gets cut off.`
            : phaseSystemPrompt,
          input,
          maxOutputTokens: PHASE_MAX_OUTPUT_TOKENS,
          timeoutMs: constrained ? RETRY_ATTEMPT_TIMEOUT_MS : PHASE_TIMEOUT_MS,
        });
      return ownerCtx ? await runWithRequestContext(ownerCtx, call) : await call();
    }

    let result = await attempt(false);
    let parsed = parseJsonResponse(result.text);
    if (!parsed && result.stopReason === "max_tokens") {
      result = await attempt(true);
      parsed = parseJsonResponse(result.text);
    }
    return parsed;
  }

  // Concurrent, not sequential: the two halves are independent reads of the
  // same ICP text, so total wall-clock is the slower of the two rather than
  // their sum -- the whole point of the split (see PHASE_TIMEOUT_MS above).
  // allSettled, so a thrown call (timeout, provider error) in one phase is
  // handled the same way as an unparseable one rather than rejecting the
  // whole briefing.
  const [titlesOutcome, proseOutcome] = await Promise.allSettled([
    runPhase(
      titlesSystemPrompt,
      "This time, cap every list at 15 items and keep every entry to just the job title.",
    ),
    runPhase(
      proseSystemPrompt,
      "This time, cap every list at 5 items and keep every line to one short sentence.",
    ),
  ]);

  const titlesParsed = titlesOutcome.status === "fulfilled" ? titlesOutcome.value : undefined;
  const proseParsed = proseOutcome.status === "fulfilled" ? proseOutcome.value : undefined;

  // Both halves failed -- there is no briefing here, so don't overwrite
  // whatever the persona already had.
  if (!titlesParsed && !proseParsed) {
    throw new Error("The model did not return a usable briefing. Try generating it again.");
  }

  const titles = titlesParsed ?? {};
  const prose = proseParsed ?? {};
  const voice = (prose.voice ?? {}) as Record<string, unknown>;

  // A half that failed is recorded as an explicit gap rather than left as a
  // silently-empty section -- same principle the prompts themselves enforce
  // for a thin ICP document: an empty section plus a named gap is honest, an
  // empty section on its own reads as "the documents didn't say".
  const phaseGaps: string[] = [];
  if (!titlesParsed) {
    phaseGaps.push("Target job titles could not be generated this run. Regenerate to fill them in.");
  }
  if (!proseParsed) {
    phaseGaps.push("Messaging guidance could not be generated this run. Regenerate to fill it in.");
  }

  const briefing: PersonaBriefing = {
    positioning: cleanLine(prose.positioning).slice(0, 600),
    titles: cleanList(titles.titles, MAX_TITLE_ITEMS),
    fallbackTitles: cleanList(titles.fallbackTitles, MAX_TITLE_ITEMS),
    avoidTitles: cleanList(titles.avoidTitles, MAX_TITLE_ITEMS),
    avoidTitlesSearch: cleanList(titles.avoidTitlesSearch, MAX_TITLE_ITEMS),
    orgPriorities: cleanList(prose.orgPriorities),
    whyTheyBuy: cleanList(prose.whyTheyBuy),
    painPoints: cleanList(prose.painPoints),
    voice: {
      tone: cleanLine(voice.tone),
      dos: cleanList(voice.dos),
      donts: cleanList(voice.donts),
    },
    openingAngles: cleanList(prose.openingAngles),
    // Both shapes carry coverageGaps (each scoped to its own half), so this
    // unions them -- cleanList already dedupes case-insensitively.
    coverageGaps: cleanList(
      [...phaseGaps, ...(Array.isArray(titles.coverageGaps) ? titles.coverageGaps : []), ...(Array.isArray(prose.coverageGaps) ? prose.coverageGaps : [])],
      MAX_ITEMS * 2,
    ),
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
