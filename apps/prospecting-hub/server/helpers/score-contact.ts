import { completeText, runWithRequestContext } from "@agent-native/core/server";
import { computeDeterministicCompanyFit } from "./company-fit.js";
import { lookupCommonRoomEngagement } from "./commonroom-engagement.js";
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
  engagementScore: number | null;
  overallScore: number | null;
  reasoning: string;
}

// Averages whichever of the given signals are actually present — a missing
// (null/undefined) signal is excluded from the average, never treated as a
// zero. If nothing is available at all, the blended score is `null`
// ("we don't know"), never `0` (a real, meaningful low score).
function averageAvailable(values: Array<number | null | undefined>): number | null {
  const present = values.filter((v): v is number => v != null);
  if (present.length === 0) return null;
  return Math.round(present.reduce((sum, v) => sum + v, 0) / present.length);
}

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

  let personaId: string | null;
  let personaMatchScore: number;
  let companyFitScore: number;
  let reasoning: string;

  if (withCriteria.length === 0) {
    personaId = null;
    personaMatchScore = 0;
    companyFitScore = 0;
    reasoning = "No personas with synced criteria yet — upload a persona doc on the Personas tab to enable scoring.";
  } else {
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

    const parsedPersonaId = typeof parsed.personaId === "string" && parsed.personaId !== "null" ? parsed.personaId : null;
    const clamp = (v: unknown) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));

    personaId = parsedPersonaId && withCriteria.some((p) => p.id === parsedPersonaId) ? parsedPersonaId : null;
    personaMatchScore = clamp(parsed.personaMatchScore);
    companyFitScore = clamp(parsed.companyFitScore);
    reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "No reasoning returned.";
  }

  // A SEPARATE, better-precision company-fit signal from firmographic data
  // (country/employees), wired in per spec even though `ContactForScoring`
  // doesn't currently carry either field — the `contacts` table has no
  // country/employees columns yet, so this always returns `null` today.
  // Not used to override `companyFitScore` above (which stays the sole,
  // AI-judged company-fit source until this signal has real inputs) and not
  // folded into `overallScore` below — this task's overallScore blends only
  // personaMatchScore/companyFitScore/engagementScore, per spec.
  computeDeterministicCompanyFit({ country: undefined, employees: undefined });

  // Best-effort: a CommonRoom hiccup (no org-scoped connection configured,
  // MCP call failure, etc.) must not fail contact scoring outright — treat
  // it the same as "no engagement signal available" (null), never an error.
  let engagementScore: number | null = null;
  try {
    engagementScore = await lookupCommonRoomEngagement({
      orgId: options.orgId,
      fullName: options.contact.name,
      companyName: options.contact.company,
    });
  } catch {
    engagementScore = null;
  }

  const overallScore = averageAvailable([personaMatchScore, companyFitScore, engagementScore]);

  return { personaId, personaMatchScore, companyFitScore, engagementScore, overallScore, reasoning };
}
