// Search paging and scoring batching in run-sourcing-rule-pipeline.ts are
// "resumable and chunked" by COUNT (a fixed number of pages/contacts per
// invocation) — but count alone doesn't bound WALL-CLOCK time. commonroom-
// client.ts's own per-call ceiling (DEFAULT_MCP_TIMEOUT_MS, 20s) means a
// handful of genuinely SLOW (not failing — just slow) CommonRoom calls can
// still exceed the hosting platform's function timeout (netlify.toml: 75s)
// well within a "bounded" page/chunk. Live-confirmed: once the CommonRoom
// connection was healthy enough to actually be exercised on every page/
// contact (instead of failing fast on a broken connection), a fresh "Find
// prospects now" run timed out at the platform's infrastructure layer.
//
// These budgets are checked BEFORE starting one more unit of work (a search
// page, or a scoring batch), not as a hard deadline mid-call — so the real
// ceiling each protects against is (budget + that one unit's own worst
// case), not the budget alone:
//   - Search: one page's worst case includes prospector-client.ts's own
//     bounded retry — up to two sequential 20s CommonRoom calls, ~40s.
//     25s budget + ~40s worst-case page ≈ 65s, ~10s under the platform's
//     75s function timeout for the checkpoint DB write and response.
//   - Scoring: one batch runs CONCURRENCY_LIMIT contacts concurrently; each
//     contact's CommonRoom cost is ~20s (warm lead-score-id cache) to ~40s
//     (cold cache — only the first batch in a 5-minute window pays this).
//     25s budget + ~40s worst-case batch ≈ 65s, same margin. This does NOT
//     bound the LLM completeText() call each contact also makes — that has
//     no explicit timeout anywhere in this codebase today, so a
//     sufficiently slow model response can still exceed 75s regardless of
//     this budget. That's a separate, pre-existing risk this fix doesn't
//     attempt to close.
export const SEARCH_TIME_BUDGET_MS = 25_000;
export const SCORING_TIME_BUDGET_MS = 25_000;

/** True while there's still budget left to start one more unit of work. */
export function withinTimeBudget(
  startedAtMs: number,
  budgetMs: number,
  nowMs: number = Date.now(),
): boolean {
  return nowMs - startedAtMs < budgetMs;
}
