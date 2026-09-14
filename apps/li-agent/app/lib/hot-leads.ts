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
import { leadQuality } from "@/lib/lead-quality";

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
  /** Read only by the legacy fallback, when fitScore is absent. */
  fitVerdict?: string | null;
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

/**
 * `stellar` is the LEGACY path and exists because of a real design mistake.
 *
 * The first version of this section required the new 0-100 fitScore, which no
 * existing lead has. On a page of 257 already-scored-the-old-way prospects it
 * therefore showed nothing but "score these leads first" -- a feature that
 * only works after 257 LLM calls is a feature that does not work.
 *
 * But the app ALREADY knows which of those are exceptional: `leadQuality()`
 * calls a lead "stellar" on a strong verdict plus a persona matched in a
 * separate earlier pass, which is the same two-independent-signals idea the
 * score-based rule uses. That is the signal the existing "Stellar" filter pill
 * runs on.
 *
 * So an unscored lead falls back to it. The granular score takes over per-lead
 * as scoring happens, with no migration and no empty state.
 */
export type HotReason = "intent" | "authority" | "stellar";

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

  // No granular score yet: fall back to the existing stellar signal so the
  // section works on today's data. See the note on HotReason.
  if (score == null) {
    const stellar = leadQuality(lead) === "stellar";
    return { hot: stellar, reasons: stellar ? ["stellar"] : [], score: null };
  }

  // Scored, but below the bar. Genuinely not hot -- and note this does NOT
  // fall back to the legacy signal. Once a lead has a real score, that score
  // is the better answer, and letting a 30 sneak in on an old `strong` verdict
  // would make the section worse as scoring rolled out rather than better.
  if (score < settings.scoreThreshold) {
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
  // Named as an estimate, because it is one: a verdict plus a persona, not a
  // measured score. Saying so is what makes "Score for detail" an obvious
  // next step rather than a mystery.
  if (reasons.includes("stellar")) parts.push("strong fit in a matched persona · rescore for a detailed score");
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
      // A scored lead outranks an unscored one at equal footing: the score is
      // evidence, the legacy signal is an estimate.
      (b.fitScore ?? -1) - (a.fitScore ?? -1) ||
      (b.scoreIntent ?? 0) - (a.scoreIntent ?? 0) ||
      (b.scoreSeniority ?? 0) - (a.scoreSeniority ?? 0),
  );
}

/** Percentage of the maximum, for a progress bar. */
export function scorePct(score: number | null | undefined): number {
  if (typeof score !== "number") return 0;
  return Math.max(0, Math.min(100, Math.round((score / MAX_FIT_SCORE) * 100)));
}
