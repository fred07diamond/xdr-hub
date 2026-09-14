import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  clampDimension,
  MAX_FIT_SCORE,
  SCORE_WEIGHTS,
  SCORING_RUBRIC,
  totalScore,
  verdictForScore,
  VERDICT_THRESHOLDS,
} from "../server/helpers/fit-score.js";

// Scoring was one LLM call producing one of four labels, with a rubric that
// said "If evidence points to strong, score it strong". Everything decent
// collapsed into `strong`, so an outstanding lead was indistinguishable from
// an adequate one. These tests pin the replacement.

describe("weights", () => {
  it("sum to 100", () => {
    expect(MAX_FIT_SCORE).toBe(100);
  });

  it("weight role fit highest and seniority lowest", () => {
    // Wrong function is not recoverable by anything else; seniority is the
    // most gameable from a freeform LinkedIn headline.
    expect(SCORE_WEIGHTS.roleFit).toBeGreaterThan(SCORE_WEIGHTS.companyFit);
    expect(SCORE_WEIGHTS.seniority).toBeLessThan(SCORE_WEIGHTS.intent);
  });

  it("give intent real weight, not a token amount", () => {
    // Intent is the dimension that separates hot from merely good, and the one
    // the old single-label rubric could only gesture at.
    expect(SCORE_WEIGHTS.intent).toBeGreaterThanOrEqual(25);
  });
});

describe("clampDimension", () => {
  it("caps at the dimension's own weight", () => {
    // A model returning 99 for a 20-point dimension must not inflate the
    // total past 100 and break every threshold downstream.
    expect(clampDimension(99, "seniority")).toBe(SCORE_WEIGHTS.seniority);
    expect(clampDimension(99, "roleFit")).toBe(SCORE_WEIGHTS.roleFit);
  });

  it("floors at zero", () => {
    expect(clampDimension(-5, "roleFit")).toBe(0);
  });

  it("treats junk as zero rather than NaN", () => {
    // A NaN would propagate through totalScore and make the verdict
    // nondeterministic.
    for (const junk of [null, undefined, "", "abc", {}, []]) {
      expect(clampDimension(junk, "roleFit"), String(junk)).toBe(0);
    }
  });

  it("accepts a numeric string, which models routinely emit", () => {
    expect(clampDimension("18", "seniority")).toBe(18);
  });
});

describe("totalScore", () => {
  it("adds the dimensions", () => {
    expect(totalScore({ roleFit: 30, companyFit: 25, intent: 25, seniority: 20 })).toBe(100);
    expect(totalScore({ roleFit: 15, companyFit: 10, intent: 5, seniority: 10 })).toBe(40);
  });

  it("cannot exceed 100 even when every dimension is over-reported", () => {
    expect(totalScore({ roleFit: 999, companyFit: 999, intent: 999, seniority: 999 })).toBe(100);
  });
});

describe("verdictForScore", () => {
  it("maps bands to the existing verdict vocabulary", () => {
    expect(verdictForScore(95)).toBe("strong");
    expect(verdictForScore(VERDICT_THRESHOLDS.strong)).toBe("strong");
    expect(verdictForScore(VERDICT_THRESHOLDS.strong - 1)).toBe("possible");
    expect(verdictForScore(VERDICT_THRESHOLDS.possible)).toBe("possible");
    expect(verdictForScore(VERDICT_THRESHOLDS.possible - 1)).toBe("weak");
    expect(verdictForScore(0)).toBe("weak");
  });

  it("returns inconclusive ONLY for an unscored lead, never for a low score", () => {
    // These are different facts and the credit gates treat them differently:
    // `inconclusive` means no ICP document exists, not that the lead is bad.
    expect(verdictForScore(0, false)).toBe("inconclusive");
    expect(verdictForScore(0, true)).toBe("weak");
  });

  it("keeps the same four values the credit gates already understand", () => {
    // verdictClearsBar, the filter pills, Analytics and the admin's configured
    // enrichMinVerdict / phoneMinVerdict all read these. A fifth value would
    // silently change what the workspace is allowed to spend on.
    const produced = new Set([
      verdictForScore(100),
      verdictForScore(50),
      verdictForScore(10),
      verdictForScore(0, false),
    ]);
    expect([...produced].sort()).toEqual(["inconclusive", "possible", "strong", "weak"]);
  });
});

describe("the rubric", () => {
  it("tells the model to use the whole range", () => {
    // The old prompt's failure was not a wrong label, it was a rubric vague
    // enough that the model had no reason to discriminate.
    expect(SCORING_RUBRIC).toMatch(/whole range/i);
    expect(SCORING_RUBRIC).toMatch(/90\+/);
  });

  it("stops intent from double-counting a good title", () => {
    // Otherwise a perfect title scores twice and every senior person looks
    // hot, which is the original complaint wearing a number.
    expect(SCORING_RUBRIC).toMatch(/already counted under Role fit/i);
  });

  it("gives every dimension an explicit anchor at its own maximum", () => {
    for (const [dim, max] of Object.entries(SCORE_WEIGHTS)) {
      expect(SCORING_RUBRIC, dim).toContain(`0-${max}`);
    }
  });
});

describe("draft-profile wiring", () => {
  const SRC = readFileSync(new URL("../server/helpers/draft-profile.ts", import.meta.url), "utf8");

  it("derives the verdict instead of asking the model for it", () => {
    // The model cannot hand back a label that disagrees with its own numbers.
    expect(SRC).toContain("verdictForScore(fitScore, true)");
    expect(SRC).not.toMatch(/"fitVerdict":\s*"strong"\|"possible"\|"weak"/);
  });

  it("only scores when an ICP document exists", () => {
    expect(SRC).toContain("if (icpText) {");
  });

  it("salvages the dimensions from a malformed response", () => {
    // Losing the score to a stray character would silently drop the lead back
    // to unscored, which looks like the scoring feature not working.
    expect(SRC).toContain('num("roleFit")');
  });

  it('does not store the literal string "null" as an intent signal', () => {
    expect(SRC).toMatch(/toLowerCase\(\) !== "null"/);
  });
});

describe("client mirror does not drift from the server", () => {
  it("has identical weights", async () => {
    // app/ and server/ are kept strictly separate in this app, so the weights
    // are duplicated on the client. This test is what makes that safe: a
    // change to one side without the other fails here rather than silently
    // rendering progress bars against the wrong maximum.
    const client = await import("../app/lib/fit-score-shared.js");
    expect(client.SCORE_WEIGHTS).toEqual(SCORE_WEIGHTS);
    expect(client.MAX_FIT_SCORE).toBe(MAX_FIT_SCORE);
    expect(client.VERDICT_THRESHOLDS).toEqual(VERDICT_THRESHOLDS);
  });

  it("renders every dimension exactly once", async () => {
    const { DIMENSION_ORDER, DIMENSION_LABELS } = await import("../app/lib/fit-score-shared.js");
    expect([...DIMENSION_ORDER].sort()).toEqual(Object.keys(SCORE_WEIGHTS).sort());
    for (const d of DIMENSION_ORDER) expect(DIMENSION_LABELS[d]).toBeTruthy();
  });
});

describe("draft-profile leaves room for an answer", () => {
  const SRC = readFileSync(new URL("../server/helpers/draft-profile.ts", import.meta.url), "utf8");

  it("runs with reasoning OFF", () => {
    // The engine default is Medium/High, and Anthropic's manual thinking
    // budgets start at 1024 against this call's 700-token cap -- thinking
    // alone could consume the whole allowance and return an empty draft,
    // surfacing as "Draft failed" or a silently unscored lead. This call
    // scores four numbered dimensions and writes a 200-character note; there
    // is nothing to reason about.
    expect(SRC).toContain('reasoningEffort: "none"');
  });
});

describe("outreach generators leave room for an answer", () => {
  const SRC = readFileSync(new URL("../server/helpers/generate-outreach.ts", import.meta.url), "utf8");

  it("runs with reasoning OFF", () => {
    expect(SRC).toContain('reasoningEffort: "none"');
  });
});
