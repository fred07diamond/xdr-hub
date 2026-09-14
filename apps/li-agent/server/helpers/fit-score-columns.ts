import { SCORE_PROMPT_VERSION } from "./fit-score-version.js";
import type { DraftResult } from "./draft-profile.js";

/**
 * Maps a draft result's score onto its database columns.
 *
 * One helper for all three write sites (capture-profile, redraft-prospect,
 * score-lead-list-item) because they write the SAME shape to two different
 * tables, and three hand-written copies is how the enrichment columns drifted
 * before the unified helper existed.
 *
 * `scoredAtVersion` records which rubric produced the numbers. Without it a
 * later prompt change leaves the table holding two incomparable score scales
 * with no way to tell them apart, so "rescore everything older than vN"
 * becomes impossible.
 */
export function fitScoreColumns(draft: DraftResult) {
  return {
    fitScore: draft.fitScore,
    scoreRoleFit: draft.fitBreakdown?.roleFit ?? null,
    scoreSeniority: draft.fitBreakdown?.seniority ?? null,
    scoreCompanyFit: draft.fitBreakdown?.companyFit ?? null,
    scoreIntent: draft.fitBreakdown?.intent ?? null,
    intentSignal: draft.intentSignal,
    // Null when nothing was scored, so an unscored row is not tagged as
    // having been assessed by this version.
    scoredAtVersion: draft.fitScore == null ? null : SCORE_PROMPT_VERSION,
  };
}
