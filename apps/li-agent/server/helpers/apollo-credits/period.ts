// Apollo's allocation renews on a fixed day of the month (the 4th for this
// workspace), not on the 1st, so "this month's spend" is not a calendar month.
// Everything that sums credits keys off the window computed here.
//
// The window is DERIVED from the clock, never stored as mutable state and
// never "reset" by a job. That is deliberate: this app has no reliable
// scheduler (see server/middleware/lead-pipeline-sweep.ts, which runs
// opportunistically on inbound requests with a per-process debounce), so any
// design that needed a cron to roll a counter over would silently keep
// charging spend to a stale period whenever the app sat idle across the
// boundary. A pure function of the clock cannot drift.

/** Lowest allowed anchor day. */
export const MIN_ANCHOR_DAY = 1;

/**
 * Highest allowed anchor day. Capped at 28 so every month contains the anchor
 * date and no clamping is ever needed -- an anchor of 31 would silently mean
 * "the 28th" in February and "the 31st" otherwise, i.e. a boundary that moves
 * by three days without the admin asking for it. Rejecting 29-31 up front is
 * clearer than clamping it later.
 */
export const MAX_ANCHOR_DAY = 28;

export const DEFAULT_ANCHOR_DAY = 4;

export interface BillingPeriod {
  /**
   * Canonical period identifier, `YYYY-MM-DD` of the anchor date. This is what
   * gets written to and queried from the ledger's `period_start` column: a
   * date-only string makes the period sum a single indexed equality match, and
   * makes two processes computing the same period produce byte-identical keys
   * regardless of sub-second clock differences.
   */
  key: string;
  /** Inclusive start instant, ISO. */
  startIso: string;
  /** EXCLUSIVE end instant, ISO -- the next period's start. */
  endIso: string;
  anchorDay: number;
}

export function clampAnchorDay(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return DEFAULT_ANCHOR_DAY;
  return Math.min(MAX_ANCHOR_DAY, Math.max(MIN_ANCHOR_DAY, Math.trunc(n)));
}

function anchorUtc(year: number, monthIndex: number, anchorDay: number): number {
  // Date.UTC normalizes out-of-range month indices (-1 -> December of the
  // previous year, 12 -> January of the next), so the year rollover needs no
  // branch of its own.
  return Date.UTC(year, monthIndex, anchorDay, 0, 0, 0, 0);
}

function toKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The billing period containing `at`.
 *
 * An instant exactly ON the anchor belongs to the period it opens, not the one
 * it closes -- `startIso` is inclusive and `endIso` is exclusive, so summing
 * `WHERE period_start = key` can never double-count a spend at the boundary.
 *
 * All arithmetic is UTC. See the timezone caveat in the plan: if Apollo resets
 * in a non-UTC zone, spend within a few hours of the boundary can land in the
 * wrong bucket. The safety margin absorbs that rather than this function
 * pretending to know Apollo's zone.
 */
export function billingPeriodContaining(anchorDayInput: unknown, at: Date = new Date()): BillingPeriod {
  const anchorDay = clampAnchorDay(anchorDayInput);
  const ms = at.getTime();
  const year = at.getUTCFullYear();
  const monthIndex = at.getUTCMonth();

  let startMs = anchorUtc(year, monthIndex, anchorDay);
  if (ms < startMs) {
    // Before this month's anchor, so we are still inside the window that
    // opened last month.
    startMs = anchorUtc(year, monthIndex - 1, anchorDay);
  }

  const startDate = new Date(startMs);
  const endMs = anchorUtc(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, anchorDay);

  return {
    key: toKey(startMs),
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
    anchorDay,
  };
}

/** Convenience wrapper for the common "right now" case. */
export function currentBillingPeriod(anchorDayInput: unknown, now: Date = new Date()): BillingPeriod {
  return billingPeriodContaining(anchorDayInput, now);
}

/**
 * Human-readable reset date for UI copy ("resets October 4"). Formatted in UTC
 * on purpose, to match the window the budget is actually enforced on -- showing
 * a viewer-local date here would tell some users the wrong day.
 */
export function formatPeriodResetLabel(period: BillingPeriod): string {
  return new Date(period.endIso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
