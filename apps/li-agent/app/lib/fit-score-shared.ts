/**
 * Client mirror of the score weights in server/helpers/fit-score.ts.
 *
 * Duplicated, not imported: `app/` and `server/` are kept strictly separate in
 * this app (neither tree imports from the other), and reaching across would
 * risk pulling server modules into the browser bundle. Same approach as the
 * EMOJI_PATTERN mirror in prospects-csv.ts and the verdictClearsBar mirror in
 * verdict-bar.ts.
 *
 * test/fit-score.test.ts asserts these numbers match the server's, so a drift
 * fails the suite rather than silently rendering bars against the wrong
 * maximum.
 */

export const SCORE_WEIGHTS = {
  roleFit: 30,
  companyFit: 25,
  intent: 25,
  seniority: 20,
} as const;

export const MAX_FIT_SCORE = 100;

export type ScoreDimension = keyof typeof SCORE_WEIGHTS;

export const DIMENSION_LABELS: Record<ScoreDimension, string> = {
  roleFit: "Role fit",
  companyFit: "Company fit",
  intent: "Intent signals",
  seniority: "Seniority",
};

/** Same order everywhere the breakdown is rendered. */
export const DIMENSION_ORDER: ScoreDimension[] = ["roleFit", "seniority", "companyFit", "intent"];

/** Verdict bands, mirrored so the UI can explain a score without a round trip. */
export const VERDICT_THRESHOLDS = { strong: 70, possible: 40 } as const;

/** Colour for a score, shared by the badge and the bars. */
export function scoreTone(score: number | null | undefined): "hot" | "strong" | "mid" | "low" | "none" {
  if (typeof score !== "number") return "none";
  if (score >= 85) return "hot";
  if (score >= VERDICT_THRESHOLDS.strong) return "strong";
  if (score >= VERDICT_THRESHOLDS.possible) return "mid";
  return "low";
}
