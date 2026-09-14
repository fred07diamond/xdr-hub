// Client-side bulk-enrich limits, shared by both tables so the two cannot
// disagree about what a "batch" is.

/**
 * Maximum records one bulk enrich may touch.
 *
 * 50 because bulk enrichment is a SEQUENTIAL client-side loop over the
 * single-record action (deliberately, to stay under Apollo's rate limits), so
 * at roughly 2s per call 50 is already ~100 seconds of a user watching a
 * progress counter. A larger cap mostly produces abandoned tabs mid-loop,
 * which strands rows in `enriching` until the reaper clears them.
 *
 * Effective ceilings before this existed: 500 on the Lead Lists page and
 * **5000** on Prospects, where "select all matching" plus one click could
 * attempt five thousand Apollo calls.
 *
 * This is a COURTESY limit. The server enforces the real ceilings (period
 * budget, per-user allowance, hourly rate limit) and returns a typed refusal,
 * because the server only ever sees independent single-record calls and cannot
 * tell that they came from one click.
 */
export const MAX_BULK_ENRICH = 50;

/** Apollo's pricing, mirrored for the pre-flight estimate. */
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
