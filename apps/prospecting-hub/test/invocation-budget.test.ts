import { describe, expect, it } from "vitest";

import {
  SCORING_TIME_BUDGET_MS,
  SEARCH_TIME_BUDGET_MS,
  withinTimeBudget,
} from "../server/helpers/invocation-budget.js";

describe("withinTimeBudget", () => {
  it("is true when no time has elapsed", () => {
    expect(withinTimeBudget(1000, 5000, 1000)).toBe(true);
  });

  it("is true while elapsed time is under the budget", () => {
    expect(withinTimeBudget(1000, 5000, 1000 + 4999)).toBe(true);
  });

  it("is false once elapsed time reaches the budget", () => {
    expect(withinTimeBudget(1000, 5000, 1000 + 5000)).toBe(false);
  });

  it("is false once elapsed time exceeds the budget", () => {
    expect(withinTimeBudget(1000, 5000, 1000 + 10_000)).toBe(false);
  });

  it("defaults `now` to the current time when omitted", () => {
    const startedAt = Date.now() - 1000;
    expect(withinTimeBudget(startedAt, 5000)).toBe(true);
  });
});

describe("time budgets leave a safety margin under the platform's function timeout", () => {
  // netlify.toml's [functions."*"] timeout = 75. Each budget is checked
  // BEFORE starting one more unit of work, so what actually has to fit
  // under 75s is (budget + that one unit's own worst case) — see
  // invocation-budget.ts's own comment for how each worst case was derived.
  const NETLIFY_FUNCTION_TIMEOUT_MS = 75_000;
  const SEARCH_PAGE_WORST_CASE_MS = 40_000; // one CommonRoom call + its one retry
  const SCORING_BATCH_WORST_CASE_MS = 40_000; // cold-cache resolveLeadScoreIds + concurrent lookups

  it("search budget plus one worst-case page stays under the function timeout", () => {
    expect(SEARCH_TIME_BUDGET_MS + SEARCH_PAGE_WORST_CASE_MS).toBeLessThan(NETLIFY_FUNCTION_TIMEOUT_MS);
  });

  it("scoring budget plus one worst-case batch stays under the function timeout", () => {
    expect(SCORING_TIME_BUDGET_MS + SCORING_BATCH_WORST_CASE_MS).toBeLessThan(NETLIFY_FUNCTION_TIMEOUT_MS);
  });
});
