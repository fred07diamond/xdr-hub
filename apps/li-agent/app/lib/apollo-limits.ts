// Client-side bulk-enrich limits, shared by both tables so the two cannot
// disagree about what a "batch" is.

/**
 * Default batch size for a bulk run. NO LONGER A CEILING.
 *
 * This was a hard cap of 50 RECORDS, and that is the wrong unit: 50 emails is
 * 50 credits while 50 phone reveals is 400, so a record cap prices two runs
 * that differ eightfold as if they were identical. On a 224-lead list it was
 * also simply in the way -- the cap, not the budget, was the thing stopping
 * the work.
 *
 * The real ceiling is credits, and both spend surfaces now compute it from
 * what the workspace and the user have left, with an editable count. This
 * constant survives only as the default batch size for callers that do not
 * pass one (runBulkEnrich, handleBulkEnrich), and as the scoring cap's
 * sibling.
 */
export const MAX_BULK_ENRICH = 50;

/** Apollo's pricing, mirrored for the pre-flight estimate. */
/**
 * Cap on a bulk SCORING run.
 *
 * Scoring costs no Apollo credits -- it is an LLM call and a database write --
 * so this is a runtime bound, not a spend bound. At a few seconds each, 50 is
 * about as long as anyone will watch a progress counter, and the same number
 * as the enrich cap keeps the two predictable.
 */
export const MAX_BULK_SCORE = 50;

export const CREDITS_PER_EMAIL = 1;
export const CREDITS_PER_PHONE_REVEAL = 8;

/**
 * Refusal codes that mean "stop the whole loop", not "skip this row".
 *
 * Both bulk loops used to `catch {}` per item and continue, so a budget block
 * produced 50 silent no-ops and the user was told nothing. Retrying 49 more
 * times against a closed budget is pure noise.
 */
export const BULK_HALT_CODES = new Set([
  "budget_exhausted",
  "user_cap_exhausted",
  "phone_budget_blocked",
  "apollo_disabled",
  "store_unavailable",
  "rate_limited",
]);

/**
 * A systemic failure (Apollo down, key revoked) should also stop the loop
 * rather than hammering through the whole selection.
 */
export const BULK_MAX_CONSECUTIVE_FAILURES = 3;

export interface BulkHaltState {
  code: string;
  message: string;
  done: number;
  total: number;
}

/** Human-readable reason a bulk run stopped early. */
export function describeHalt(code: string, fallback?: string): string {
  switch (code) {
    case "budget_exhausted":
      return "The workspace is out of Apollo credits for this period.";
    case "user_cap_exhausted":
      return "You have used your personal Apollo credit allowance for this period.";
    case "phone_budget_blocked":
      return "Phone reveals are paused because the workspace is low on Apollo credits.";
    case "apollo_disabled":
      return "Apollo enrichment is turned off for this workspace.";
    case "store_unavailable":
      return "Apollo credit accounting is unavailable, so enrichment is paused.";
    case "rate_limited":
      return "Too many enrichment calls in the last hour.";
    case "repeated_failure":
      return "Several leads failed in a row, so the run was stopped.";
    default:
      return fallback ?? "The run was stopped.";
  }
}

export function formatCreditCount(n: number): string {
  return n.toLocaleString();
}
