/**
 * Bump when the scoring rubric changes in a way that shifts the numbers.
 *
 * Kept in its own module so both the prompt side and the persistence side can
 * import it without a cycle (fit-score-columns needs DraftResult's type, and
 * draft-profile needs the rubric).
 */
export const SCORE_PROMPT_VERSION = "s1";
