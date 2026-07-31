import { completeText, runWithRequestContext } from "@agent-native/core/server";
import { decodePersonaCriteria } from "./persona-sync.js";

export interface PersonaForScoring {
  id: string;
  name: string;
  criteria: string | null; // encoded, as stored on the personas row
}

export interface ContactForScoring {
  name: string;
  title: string | null;
  company: string | null;
}

export interface ContactScoreResult {
  personaId: string | null;
  personaMatchScore: number;
  companyFitScore: number;
  reasoning: string;
}

const NO_PERSONAS_RESULT: ContactScoreResult = {
  personaId: null,
  personaMatchScore: 0,
  companyFitScore: 0,
  reasoning: "No personas with synced criteria yet — upload a persona doc on the Personas tab to enable scoring.",
};

function buildContactBlurb(c: ContactForScoring): string {
  return [c.name, c.title && c.company ? `${c.title} at ${c.company}` : (c.title ?? c.company)]
    .filter(Boolean)
    .join(" — ");
}

// One completeText() call per contact: picks the single best-fitting persona
// (if more than one is configured) and scores fit against it in the same
// pass, per the plan's design — grounded only in the persona's synced
// document text and the contact's own fields, never inventing company facts
// the contact record doesn't actually contain.
export async function scoreContactAgainstPersonas(options: {
  contact: ContactForScoring;
  personas: PersonaForScoring[];
  userEmail: string;
  orgId?: string | null;
}): Promise<ContactScoreResult> {
  const withCriteria = options.personas
    .map((p) => ({ id: p.id, name: p.name, text: decodePersonaCriteria(p.criteria) }))
    .filter((p): p is { id: string; name: string; text: string } => !!p.text);

  if (withCriteria.length === 0) return NO_PERSONAS_RESULT;

  const personaBlock = withCriteria
    .map((p, i) => `${i + 1}. id="${p.id}" name="${p.name}"\n${p.text.slice(0, 3000)}`)
    .join("\n\n---\n\n");

  const systemPrompt =
    "You score how well a contact fits a set of target-customer personas, for a sales team prioritizing outbound prospecting.\n\n" +
    `Personas:\n${personaBlock}\n\n` +
    "Pick the SINGLE best-matching persona (or none, if no persona is even a loose fit) and score:\n" +
    "- personaMatchScore (0-100): how well the contact's title/seniority/role matches that persona's stated target titles or attributes. Base this ONLY on the contact's given title, never invent seniority or responsibilities the title doesn't imply.\n" +
    "- companyFitScore (0-100): how well the contact's company matches any company-level criteria the persona describes (size, industry, tech stack, etc.). If the persona gives no company criteria, or the contact's company name alone gives no signal either way, score this 50 (neutral) rather than guessing — never invent facts about the company that aren't in the persona doc or contact record.\n\n" +
    'Reply with valid JSON only: { "personaId": "<id or null>", "personaMatchScore": <0-100>, "companyFitScore": <0-100>, "reasoning": "<one or two sentences citing the specific persona criteria and contact fields that drove the scores>" }';

  const input = buildContactBlurb(options.contact) || "Unknown contact";
  const call = () => completeText({ systemPrompt, input, maxOutputTokens: 300 });
  const result = await runWithRequestContext(
    { userEmail: options.userEmail, orgId: options.orgId ?? undefined },
    call,
  );

  const raw = result.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Unparseable scoring response: ${raw.slice(0, 200)}`);
  }

  const personaId = typeof parsed.personaId === "string" && parsed.personaId !== "null" ? parsed.personaId : null;
  const clamp = (v: unknown) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));

  return {
    personaId: personaId && withCriteria.some((p) => p.id === personaId) ? personaId : null,
    personaMatchScore: clamp(parsed.personaMatchScore),
    companyFitScore: clamp(parsed.companyFitScore),
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "No reasoning returned.",
  };
}
