/**
 * The granular fit score, and the verdict derived from it.
 *
 * ## Why this exists
 *
 * Scoring used to be one LLM call producing one of four labels, with a rubric
 * that said "If evidence points to strong, score it strong". Everything decent
 * therefore collapsed into `strong`, and an outstanding lead was
 * indistinguishable from a merely acceptable one -- which is exactly the
 * complaint. There was no ordering within a bucket and no way to say WHY one
 * lead beat another.
 *
 * ## Why the verdict is DERIVED rather than replaced
 *
 * `fitVerdict` is load-bearing in ways that are easy to miss:
 *
 * - `verdictClearsBar()` gates enrichment (1 credit) and phone reveals (8) in
 *   the credit guard. Changing its vocabulary changes what the workspace is
 *   allowed to spend money on.
 * - The Prospects verdict filter pills, the Analytics verdict counts, the
 *   badges, and `leadQuality()` all read it.
 * - Admins have configured `enrichMinVerdict` / `phoneMinVerdict` in terms of
 *   it.
 *
 * So the score is ADDITIVE. The model now produces the sub-scores, and the
 * verdict falls out of the total via fixed thresholds. Every existing gate,
 * filter and setting keeps working with no migration, and the ordering within
 * a verdict comes for free.
 *
 * ## The weights
 *
 * Out of 100, and deliberately not four equal quarters:
 *
 * - Role fit (30) -- the largest single input, because the wrong function is
 *   not recoverable by anything else.
 * - Company fit (25) -- right person, wrong company is still a miss.
 * - Intent signals (25) -- weighted this high on purpose. A specific recent
 *   post about the space is the best available predictor of a reply, and it is
 *   the dimension the old single-label rubric could only gesture at.
 * - Seniority (20) -- smallest, because it is the most gameable from a title
 *   and the least reliable from a freeform LinkedIn headline.
 */

export const SCORE_WEIGHTS = {
  roleFit: 30,
  companyFit: 25,
  intent: 25,
  seniority: 20,
} as const;

export const MAX_FIT_SCORE = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);

export type ScoreDimension = keyof typeof SCORE_WEIGHTS;

export interface FitBreakdown {
  roleFit: number;
  companyFit: number;
  intent: number;
  seniority: number;
}

export type FitVerdict = "strong" | "possible" | "weak" | "inconclusive";

/**
 * Score thresholds for the derived verdict.
 *
 * Chosen so the mapping is roughly compatible with how the old labels landed:
 * a lead that would have been called `strong` generally clears 70, and `weak`
 * generally falls under 40. That matters because admins have already tuned
 * `enrichMinVerdict` / `phoneMinVerdict` against the old meanings, and a
 * silent shift in what "strong" admits would silently change spend.
 */
export const VERDICT_THRESHOLDS = { strong: 70, possible: 40 } as const;

/** Clamps a raw dimension score into its weight. */
export function clampDimension(value: unknown, dimension: ScoreDimension): number {
  const max = SCORE_WEIGHTS[dimension];
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, Math.round(n)));
}

/** Total of the four dimensions, clamped to 0..100. */
export function totalScore(breakdown: FitBreakdown): number {
  return Math.max(
    0,
    Math.min(
      MAX_FIT_SCORE,
      clampDimension(breakdown.roleFit, "roleFit") +
        clampDimension(breakdown.companyFit, "companyFit") +
        clampDimension(breakdown.intent, "intent") +
        clampDimension(breakdown.seniority, "seniority"),
    ),
  );
}

/**
 * The verdict a score implies.
 *
 * `inconclusive` is NOT a score band -- it means "no ICP document uploaded, so
 * fit was never assessed", which is a different fact from a low score and is
 * treated differently by the credit gates. Callers pass `scored: false` for
 * that case rather than relying on a sentinel number.
 */
export function verdictForScore(score: number, scored = true): FitVerdict {
  if (!scored) return "inconclusive";
  if (score >= VERDICT_THRESHOLDS.strong) return "strong";
  if (score >= VERDICT_THRESHOLDS.possible) return "possible";
  return "weak";
}

/** Human label for a dimension, used by the UI and the prompt. */
export const DIMENSION_LABELS: Record<ScoreDimension, string> = {
  roleFit: "Role fit",
  companyFit: "Company fit",
  intent: "Intent signals",
  seniority: "Seniority",
};

/**
 * The rubric handed to the model.
 *
 * Spelled out per dimension with explicit anchors, because the failure mode of
 * the old prompt was not a wrong label, it was a rubric vague enough that the
 * model had no reason to discriminate. Anchors give it something to land on.
 */
export const SCORING_RUBRIC = [
  `Score each dimension independently. Do not let one dimension pull the others.`,
  ``,
  `ROLE FIT (0-${SCORE_WEIGHTS.roleFit}) — does what they DO match the ICP?`,
  `  ${SCORE_WEIGHTS.roleFit}: the ICP's named function, and they own the problem it describes.`,
  `  20-25: same function, adjacent remit.`,
  `  10-19: neighbouring function that touches the problem.`,
  `  0-9: different function, or no evidence of what they own.`,
  ``,
  `SENIORITY (0-${SCORE_WEIGHTS.seniority}) — can they act?`,
  `  ${SCORE_WEIGHTS.seniority}: budget holder or the decision maker the ICP names.`,
  `  12-16: influences the decision; a senior IC or manager who would be consulted.`,
  `  5-11: too junior to decide but close to the work.`,
  `  0-4: no signal, or clearly not involved.`,
  `  Judge from the real scope described, not the title alone. LinkedIn headlines`,
  `  are freeform and routinely inflate or obscure level.`,
  ``,
  `COMPANY FIT (0-${SCORE_WEIGHTS.companyFit}) — is the ACCOUNT right?`,
  `  ${SCORE_WEIGHTS.companyFit}: matches the ICP's industry, size and stage.`,
  `  15-20: right industry, size or stage uncertain.`,
  `  7-14: plausible but outside the stated profile.`,
  `  0-6: clearly outside it, or nothing known about the company.`,
  ``,
  `INTENT SIGNALS (0-${SCORE_WEIGHTS.intent}) — is there evidence they care NOW?`,
  `  ${SCORE_WEIGHTS.intent}: recent, specific and public — a post, comment or share`,
  `    about this exact problem, a competing or adjacent tool, or a named person in`,
  `    the space.`,
  `  15-20: engaged with the broad theme recently, or a role change into the remit.`,
  `  7-14: the About section claims relevant priorities, but nothing dated.`,
  `  0-6: no activity supplied, or nothing related.`,
  `  THIS IS THE DIMENSION THAT SEPARATES A GREAT LEAD FROM AN ADEQUATE ONE.`,
  `  A perfect title with no signal is a good lead, not a hot one. Do not award`,
  `  points here for a strong title; that is already counted under Role fit.`,
  ``,
  `Be willing to use the whole range. If every lead scores in the eighties the`,
  `score is useless — reserve 90+ for leads you would genuinely prioritise today`,
  `over everything else in the list.`,
].join("\n");

/** JSON contract appended to the prompt. */
export const SCORE_JSON_CONTRACT =
  `"score": { "roleFit": <0-${SCORE_WEIGHTS.roleFit}>, "seniority": <0-${SCORE_WEIGHTS.seniority}>, ` +
  `"companyFit": <0-${SCORE_WEIGHTS.companyFit}>, "intent": <0-${SCORE_WEIGHTS.intent}> }, ` +
  `"intentSignal": "<the single specific recent signal you scored Intent on, or null if none — quote or paraphrase it in under 120 chars>", `;
