/**
 * Bump when the scoring rubric changes in a way that shifts the numbers.
 *
 * Kept in its own module so both the prompt side and the persistence side can
 * import it without a cycle (fit-score-columns needs DraftResult's type, and
 * draft-profile needs the rubric).
 */
// s2: dimensions with no supporting evidence are EXCLUDED from the total
// rather than scored zero, so the same lead now scores higher than under s1.
// Recorded per row, so a mixed table is still comparable.
export const SCORE_PROMPT_VERSION = "s2";
