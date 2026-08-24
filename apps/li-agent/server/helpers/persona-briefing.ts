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
 * drafts from it -- selectPersona/draftProfile still read icpPersonas.icpText
 * directly. If this and the documents ever disagree, the documents win, which
 * is why the briefing carries the hash of the text it came from (see
 * hashIcpText) and the UI marks it stale rather than quietly serving a
 * briefing that no longer matches the uploaded criteria.
 */
export interface PersonaBriefing {
  /** Two or three sentences: who this persona is and where they sit. */
  positioning: string;
  /** Titles worth reaching out to. */
  titles: string[];
  /** Titles that look adjacent but are the wrong buyer. */
  avoidTitles: string[];
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

// Chars of persona icpText fed to the briefing prompt. Higher than
// draft-profile's 3000 because a briefing is generated once, on demand,
// and wants the whole ICP rather than enough to judge one profile.
const MAX_ICP_CHARS = 12_000;

const MAX_ITEMS = 8;
const MAX_ITEM_CHARS = 240;

/**
 * Fingerprint of the ICP text a briefing was generated from, stored alongside
 * it so a briefing can be shown as stale once documents are added or removed.
 * Truncated to 16 hex chars: this is change detection, not security.
 */
export function hashIcpText(icpText: string): string {
  return createHash("sha256").update(icpText).digest("hex").slice(0, 16);
}

function cleanLine(value: unknown): string {
  return stripEmDashes(String(value ?? "").trim()).slice(0, MAX_ITEM_CHARS);
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(cleanLine).filter(Boolean).slice(0, MAX_ITEMS);
}

const BRIEFING_SHAPE = `{
  "positioning": "<2-3 sentences: who this persona is, seniority, where they sit in the org>",
  "titles": ["<exact job titles worth reaching out to>"],
  "avoidTitles": ["<titles that look adjacent but are the wrong buyer, if the documents indicate any>"],
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
    `Reply with valid JSON only, in exactly this shape:\n${BRIEFING_SHAPE}`;

  const call = () =>
    completeText({
      systemPrompt,
      input: `Persona name: ${personaName}\n\nICP documents:\n${icpText.slice(0, MAX_ICP_CHARS)}`,
      maxOutputTokens: 1600,
    });

  const result = ownerCtx ? await runWithRequestContext(ownerCtx, call) : await call();

  const raw = result.text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  let parsed: Record<string, any>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The model did not return a usable briefing. Try generating it again.");
  }

  const voice = (parsed.voice ?? {}) as Record<string, unknown>;
  const briefing: PersonaBriefing = {
    positioning: cleanLine(parsed.positioning).slice(0, 600),
    titles: cleanList(parsed.titles),
    avoidTitles: cleanList(parsed.avoidTitles),
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
    briefing.whyTheyBuy.length > 0 ||
    briefing.orgPriorities.length > 0;
  if (!hasContent) {
    throw new Error("The model returned an empty briefing. Try generating it again.");
  }

  return briefing;
}
