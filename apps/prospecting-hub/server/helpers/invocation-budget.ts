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
//     contact makes a completeText() call (bounded to LLM_CALL_TIMEOUT_MS,
//     20s — see below) followed by a CommonRoom engagement lookup, ~20s once
//     the run-sourcing-rule-pipeline.ts scoring loop pre-warms the
//     LeadScore-id cache once up front (see warmLeadScoreIdCache) instead of
//     every contact separately racing to resolve it cold. Worst case per
//     contact ≈ 20s (LLM) + 20s (warm-cache CommonRoom lookups) = 40s; since
//     the batch runs those concurrently, the batch's own worst case is the
//     same ~40s, not a multiple of it. 25s budget + ~40s worst-case batch ≈
//     65s, same margin as search.
export const SEARCH_TIME_BUDGET_MS = 25_000;
export const SCORING_TIME_BUDGET_MS = 25_000;

// completeText() (the LLM call underneath deriveProspectorFilters,
// deriveIcpCompanyFilters, and scoreContactAgainstPersonas) accepts an
// optional `timeoutMs`, but none of this pipeline's three call sites passed
// one — live-confirmed: completeText has NO default internal timeout, so an
// omitted timeoutMs leaves the call fully at the mercy of the model
// provider's own response time, with no upper bound at all. Unlike the
// CommonRoom search/scoring budgets above, this isn't "checked before
// starting one more unit of work" — it's a genuinely unbounded hang that sits
// entirely OUTSIDE SEARCH_TIME_BUDGET_MS's accounting: deriveProspectorFilters
// runs once, in the fresh-start preamble, BEFORE the search loop's first
// withinTimeBudget check even happens, so a slow model response there can by
// itself consume the platform's entire 75s function timeout with recordsFound
// still at 0 — exactly the "No progress recorded" timeout symptom seen live,
// even after the search-page/DB-index fixes. Bounding every completeText()
// call in this pipeline converts that indefinite hang into a fast, honest,
// catchable error instead. Bounding these calls doesn't make the fresh-start
// preamble itself budget-checked (searchIcpCompanies' own ICP-derivation
// completeText() call, its ProspectorCompany MCP lookup, and
// deriveProspectorFilters' completeText() call can all run before the search
// loop's first withinTimeBudget check) — but it does make that preamble's
// worst case a known, finite number (up to ~60s for an ICP-qualified rule
// needing full auto-derivation: 20s + 20s + 20s) instead of unbounded. The
// loop's own first budget check, comparing against invocationStartedAt (set
// at the true top of the action, before any of this), correctly accounts for
// whatever the preamble already spent: if it ran long, the loop simply
// refuses to start a page and checkpoints immediately rather than compounding
// on top of an already-large elapsed time.
export const LLM_CALL_TIMEOUT_MS = 20_000;

/** True while there's still budget left to start one more unit of work. */
export function withinTimeBudget(
  startedAtMs: number,
  budgetMs: number,
  nowMs: number = Date.now(),
): boolean {
  return nowMs - startedAtMs < budgetMs;
}
