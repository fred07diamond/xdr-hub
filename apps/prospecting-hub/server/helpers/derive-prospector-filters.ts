import { completeText, runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "@agent-native/core/db/schema";
import { getPersonaCriteriaText, getSharedDb, sharedPersonas } from "@xdr-hub/shared/server";
import { getDb } from "../db/index.js";
import { subPersonas } from "../db/schema.js";
import { LLM_CALL_TIMEOUT_MS } from "./invocation-budget.js";
import { decodePersonaCriteria } from "./persona-sync.js";

export interface DerivedProspectorFilters {
  // Kept for the two existing single-value callers (search-commonroom-
  // prospects.ts, import-prospects-to-segment.ts) — always the first entry
  // of `titleKeywords` below, so neither needs to change.
  titleKeyword: string | null;
  // Real matches for the same underlying role often DON'T share one exact
  // phrase — "VP of Design", "Head of Design", and "Design Director" are all
  // the same role, but a single rigid substring like "Director of Design"
  // misses two of the three. CommonRoom's title filter is a literal
  // contiguous-substring match (confirmed live), not a fuzzy/word-order/
  // synonym-tolerant one, so a single derived phrase is brittle exactly
  // where it matters most — a narrow company allow-list has little room to
  // absorb a near-miss. run-sourcing-rule-pipeline.ts OR's these together
  // (the same mechanism already proven for manual multi-keyword overrides)
  // instead of using titleKeyword alone.
  titleKeywords: string[];
  seniority: string | null;
}

const SENIORITY_LEVELS = ["Intern", "Junior IC", "Senior IC", "Manager", "Director", "VP", "C-Level"];

// One completeText() call, factored into a plain function (not just inline
// in the action) so search-commonroom-prospects.ts and
// import-prospects-to-segment.ts can call it directly instead of making a
// nested action-to-action HTTP hop. Grounded only in the persona's (and, if
// given, sub-persona's) synced criteria text — never invents a title or
// seniority level the text doesn't actually support.
export async function deriveProspectorFilters(options: {
  personaId: string;
  subPersonaId?: string | null;
  userEmail: string;
  orgId?: string | null;
  // Optional supplementary grounding text (e.g. up to 2 linked Sales Library
  // doc excerpts, per Task 14's sourcing-rule pipeline) appended to the
  // prompt as clearly-labeled reference material distinct from the core
  // persona/sub-persona criteria text above. Backward compatible: every
  // existing call site (derive-prospector-filters.ts,
  // search-commonroom-prospects.ts, import-prospects-to-segment.ts) simply
  // omits it.
  extraContext?: string;
}): Promise<DerivedProspectorFilters> {
  const db = getDb();
  const sharedDb = getSharedDb();

  const personaRows = await sharedDb
    .select({ id: sharedPersonas.id, name: sharedPersonas.name })
    .from(sharedPersonas)
    .where(eq(sharedPersonas.id, options.personaId))
    .limit(1);
  const persona = personaRows[0];
  if (!persona) {
    throw Object.assign(new Error(`Persona ${options.personaId} not found.`), { statusCode: 404 });
  }

  const { text: personaText } = await getPersonaCriteriaText(sharedDb, options.personaId);
  let criteriaText = personaText ?? "";

  if (options.subPersonaId) {
    const subRows = await db
      .select({ id: subPersonas.id, criteria: subPersonas.criteria })
      .from(subPersonas)
      .where(and(eq(subPersonas.id, options.subPersonaId), eq(subPersonas.personaId, options.personaId)))
      .limit(1);
    const subPersona = subRows[0];
    if (!subPersona) {
      throw Object.assign(
        new Error(`Sub-persona ${options.subPersonaId} not found under persona ${options.personaId}.`),
        { statusCode: 404 },
      );
    }
    const subText = decodePersonaCriteria(subPersona.criteria);
    if (subText) criteriaText = criteriaText ? `${criteriaText}\n\n${subText}` : subText;
  }

  if (!criteriaText) {
    // statusCode matters here, not just message text -- an unclassified
    // thrown Error surfaces to the client as a bare "Internal server error"
    // (the framework masks raw exception messages by default), while one
    // tagged with a statusCode gets its real message shown. This is an
    // expected, actionable condition (persona has no title-targeting
    // configured), not a genuine bug, so it should read as one.
    throw Object.assign(
      new Error(
        `Persona ${options.personaId} has no synced criteria text to derive Prospector filters from — add Title include keywords on the Personas page, or upload a criteria document, before running this sourcing rule.`,
      ),
      { statusCode: 400 },
    );
  }

  const systemPrompt =
    "You read a target-customer persona's criteria text and propose CommonRoom Prospector search parameters for finding matching contacts, for a sales team's outbound prospecting pipeline.\n\n" +
    `Persona criteria:\n${criteriaText.slice(0, 4000)}\n\n` +
    (options.extraContext
      ? "Supplementary reference material (Sales Library docs) — additional context only, not a source of truth; the persona criteria above always takes priority if the two ever conflict:\n" +
        `${options.extraContext.slice(0, 4000)}\n\n`
      : "") +
    "Propose:\n" +
    '- titleKeywords: an array of 1-3 short DISCIPLINE/FUNCTION keywords this persona targets — what field or team they work in (e.g. "Design", "Product Design", "Engineering", "Sales"). Do NOT include any seniority or level word (no "Director", "VP", "Head of", "Manager", "Lead", "Senior", etc.) — seniority is captured entirely by the separate field below, and combining a level word into the title phrase makes it a rigid compound phrase that misses real people whose actual title uses a different level word or word order for the exact same role (e.g. "VP of Design" vs "Design Director" vs "Head of Design" are the same seniority+discipline, but only one exact phrase would match a literal substring search). This will be matched as a literal, case-insensitive SUBSTRING search against the person\'s FULL title string, so a short discipline word alone (e.g. just "Design") still correctly matches "VP of Design", "Design Director", "Senior Director, Design", etc. — prefer the shortest, most common real-world term for the discipline itself over a longer or more specific phrase. Base every entry ONLY on what the criteria text actually says — never invent a discipline the doc doesn\'t support.\n' +
    `- seniority: one of ${SENIORITY_LEVELS.map((s) => `"${s}"`).join(", ")}, or null if the criteria text gives no clear seniority signal — never guess a seniority level the doc doesn't support. This is where level/rank belongs, not in titleKeywords.\n\n` +
    'Reply with valid JSON only: { "titleKeywords": ["<discipline keyword 1>", ...], "seniority": "<one of the levels above, or null>" }';

  const call = () =>
    completeText({
      systemPrompt,
      input: "Derive Prospector search parameters.",
      maxOutputTokens: 300,
      timeoutMs: LLM_CALL_TIMEOUT_MS,
    });
  const result = await runWithRequestContext(
    { userEmail: options.userEmail, orgId: options.orgId ?? undefined },
    call,
  );

  const raw = result.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Unparseable Prospector filter response: ${raw.slice(0, 200)}`);
  }

  const titleKeywords = Array.isArray(parsed.titleKeywords)
    ? parsed.titleKeywords.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim())
    : [];
  const seniority =
    typeof parsed.seniority === "string" && SENIORITY_LEVELS.includes(parsed.seniority) ? parsed.seniority : null;

  return { titleKeyword: titleKeywords[0] ?? null, titleKeywords, seniority };
}
