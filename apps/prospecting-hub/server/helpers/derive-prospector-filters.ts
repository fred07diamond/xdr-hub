import { completeText, runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "@agent-native/core/db/schema";
import { getDb } from "../db/index.js";
import { personas, subPersonas } from "../db/schema.js";
import { decodePersonaCriteria } from "./persona-sync.js";

export interface DerivedProspectorFilters {
  titleKeyword: string | null;
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

  const personaRows = await db
    .select({ id: personas.id, name: personas.name, criteria: personas.criteria })
    .from(personas)
    .where(eq(personas.id, options.personaId))
    .limit(1);
  const persona = personaRows[0];
  if (!persona) {
    throw Object.assign(new Error(`Persona ${options.personaId} not found.`), { statusCode: 404 });
  }

  let criteriaText = decodePersonaCriteria(persona.criteria) ?? "";

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
    throw new Error(`Persona ${options.personaId} has no synced criteria text to derive Prospector filters from.`);
  }

  const systemPrompt =
    "You read a target-customer persona's criteria text and propose CommonRoom Prospector search parameters for finding matching contacts, for a sales team's outbound prospecting pipeline.\n\n" +
    `Persona criteria:\n${criteriaText.slice(0, 4000)}\n\n` +
    (options.extraContext
      ? "Supplementary reference material (Sales Library docs) — additional context only, not a source of truth; the persona criteria above always takes priority if the two ever conflict:\n" +
        `${options.extraContext.slice(0, 4000)}\n\n`
      : "") +
    "Propose:\n" +
    '- titleKeyword: a short job-title keyword or phrase (e.g. "VP Engineering") that best captures the target title(s) this persona describes. Base this ONLY on what the criteria text actually says — never invent a title the doc doesn\'t support.\n' +
    `- seniority: one of ${SENIORITY_LEVELS.map((s) => `"${s}"`).join(", ")}, or null if the criteria text gives no clear seniority signal — never guess a seniority level the doc doesn't support.\n\n` +
    'Reply with valid JSON only: { "titleKeyword": "<short title keyword or phrase>", "seniority": "<one of the levels above, or null>" }';

  const call = () => completeText({ systemPrompt, input: "Derive Prospector search parameters.", maxOutputTokens: 200 });
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

  const titleKeyword =
    typeof parsed.titleKeyword === "string" && parsed.titleKeyword.trim() ? parsed.titleKeyword.trim() : null;
  const seniority =
    typeof parsed.seniority === "string" && SENIORITY_LEVELS.includes(parsed.seniority) ? parsed.seniority : null;

  return { titleKeyword, seniority };
}
