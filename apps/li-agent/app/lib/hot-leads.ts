/**
 * What makes a lead "hot" enough to surface above the list.
 *
 * Three criteria, and the shape of the rule matters more than the numbers:
 *
 *   score >= threshold   AND   (recent intent signal  OR  persona + seniority)
 *
 * The score is the GATE. The other two are CORROBORATORS, and at least one is
 * required. That is deliberate rather than an AND of all three, for a reason
 * the old scoring already demonstrated: a single model judgment, however
 * confident, is one opinion. Requiring a second independent signal is the same
 * logic `leadQuality()` already used to define "stellar" (strong verdict AND a
 * persona matched in a separate earlier pass).
 *
 * Why not score alone: a 90 built entirely out of role/company/seniority is a
 * lead who looks perfect on paper with no evidence they care right now. Worth
 * contacting, not worth jumping the queue for.
 *
 * Why not intent alone: someone posting about the space who is junior at an
 * out-of-profile company is noise.
 */

import { MAX_FIT_SCORE, SCORE_WEIGHTS } from "@/lib/fit-score-shared";

export interface HotLeadSettings {
  /** Minimum total score. */
  scoreThreshold: number;
  /** How recent a scoring pass must be for its intent signal to count, in days. */
  intentWindowDays: number;
}

export const HOT_LEAD_DEFAULTS: HotLeadSettings = {
  // 85 of 100. High enough that it stays a short list -- a "hot" section
  // containing half the page is just the page again.
  scoreThreshold: 85,
  // Intent decays. A post from three days ago predicts a reply; the same post
  // from four months ago is history, and treating them alike is what makes an
  // intent score meaningless over time.
  intentWindowDays: 30,
};

/** Minimum Intent points that count as a real, recent signal. */
export const MIN_INTENT_FOR_HOT = Math.round(SCORE_WEIGHTS.intent * 0.6);
/** Minimum Seniority points that count as decision-making level. */
export const MIN_SENIORITY_FOR_HOT = Math.round(SCORE_WEIGHTS.seniority * 0.8);

export interface ScorableLead {
  fitScore?: number | null;
  scoreRoleFit?: number | null;
  scoreCompanyFit?: number | null;
  scoreIntent?: number | null;
  scoreSeniority?: number | null;
  intentSignal?: string | null;
  personaName?: string | null;
  scoredAt?: string | null;
  updatedAt?: string | null;
  rating?: number | null;
}

export type HotReason = "intent" | "authority";

export interface HotAssessment {
  hot: boolean;
  /** Which corroborators fired. Empty when the lead is not hot. */
  reasons: HotReason[];
  score: number | null;
}

/** Was this lead scored recently enough for its intent signal to still count? */
export function intentIsFresh(lead: ScorableLead, windowDays: number, now = Date.now()): boolean {
  const stamp = lead.scoredAt ?? lead.updatedAt ?? null;
  // No timestamp means we cannot date the signal. Treated as fresh rather than
  // stale: the alternative silently excludes every lead scored before
  // scoredAt was populated, which would make the section look broken.
  if (!stamp) return true;
  const t = new Date(stamp).getTime();
  if (Number.isNaN(t)) return true;
  return now - t <= windowDays * 24 * 60 * 60 * 1000;
}

export function assessHotLead(
  lead: ScorableLead,
  settings: HotLeadSettings = HOT_LEAD_DEFAULTS,
  now = Date.now(),
): HotAssessment {
  const score = typeof lead.fitScore === "number" ? lead.fitScore : null;
  // Unscored is NOT hot, and is not the same as low. A lead nobody has scored
  // has no claim on the top of the page.
  if (score == null || score < settings.scoreThreshold) {
    return { hot: false, reasons: [], score };
  }

  const reasons: HotReason[] = [];
  if (
    (lead.scoreIntent ?? 0) >= MIN_INTENT_FOR_HOT &&
    !!lead.intentSignal &&
    intentIsFresh(lead, settings.intentWindowDays, now)
  ) {
    reasons.push("intent");
  }
  if (!!lead.personaName && (lead.scoreSeniority ?? 0) >= MIN_SENIORITY_FOR_HOT) {
    reasons.push("authority");
  }

  return { hot: reasons.length > 0, reasons, score };
}

export function isHotLead(
  lead: ScorableLead,
  settings: HotLeadSettings = HOT_LEAD_DEFAULTS,
  now = Date.now(),
): boolean {
  return assessHotLead(lead, settings, now).hot;
}

/** Short explanation of why a lead is hot, for the UI. */
export function describeHotReasons(reasons: HotReason[]): string {
  const parts: string[] = [];
  if (reasons.includes("intent")) parts.push("engaged with your space recently");
  if (reasons.includes("authority")) parts.push("decision-level in a matched persona");
  return parts.join(" · ");
}

/**
 * Hot leads, best first.
 *
 * Ties break on intent rather than on id or name: between two leads at the
 * same score, the one with live evidence of interest is the one to contact
 * first, and an arbitrary tie-break would make the top of the list feel
 * random.
 */
export function sortHotLeads<T extends ScorableLead>(leads: T[]): T[] {
  return [...leads].sort(
    (a, b) =>
      (b.fitScore ?? 0) - (a.fitScore ?? 0) ||
      (b.scoreIntent ?? 0) - (a.scoreIntent ?? 0) ||
      (b.scoreSeniority ?? 0) - (a.scoreSeniority ?? 0),
  );
}

/** Percentage of the maximum, for a progress bar. */
export function scorePct(score: number | null | undefined): number {
  if (typeof score !== "number") return 0;
  return Math.max(0, Math.min(100, Math.round((score / MAX_FIT_SCORE) * 100)));
}
