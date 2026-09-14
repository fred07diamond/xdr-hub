import { describe, expect, it } from "vitest";

import {
  assessHotLead,
  describeHotReasons,
  HOT_LEAD_DEFAULTS,
  intentIsFresh,
  isHotLead,
  MIN_INTENT_FOR_HOT,
  MIN_SENIORITY_FOR_HOT,
  sortHotLeads,
} from "../app/lib/hot-leads.js";

// The rule is: score >= threshold AND (recent intent OR persona+seniority).
// The score is the gate; the other two are corroborators and at least one is
// required. Score alone would promote a lead who looks perfect on paper with
// no evidence they care right now.

const NOW = new Date("2026-09-14T12:00:00Z").getTime();
const recent = new Date("2026-09-12T12:00:00Z").toISOString();
const old = new Date("2026-05-01T12:00:00Z").toISOString();

const HOT_BY_INTENT = {
  fitScore: 92,
  scoreIntent: MIN_INTENT_FOR_HOT,
  intentSignal: "Posted about design-system tooling 3 days ago",
  scoredAt: recent,
};

const HOT_BY_AUTHORITY = {
  fitScore: 88,
  scoreSeniority: MIN_SENIORITY_FOR_HOT,
  personaName: "Product",
  scoredAt: recent,
};

describe("assessHotLead", () => {
  it("promotes a high score with a fresh intent signal", () => {
    const a = assessHotLead(HOT_BY_INTENT, HOT_LEAD_DEFAULTS, NOW);
    expect(a.hot).toBe(true);
    expect(a.reasons).toEqual(["intent"]);
  });

  it("promotes a high score with persona plus decision-level seniority", () => {
    const a = assessHotLead(HOT_BY_AUTHORITY, HOT_LEAD_DEFAULTS, NOW);
    expect(a.hot).toBe(true);
    expect(a.reasons).toEqual(["authority"]);
  });

  it("does NOT promote a high score with no corroborating signal", () => {
    // A 95 built purely from role, company and a title is a lead who looks
    // perfect on paper. Worth contacting, not worth jumping the queue.
    const a = assessHotLead(
      { fitScore: 95, scoreIntent: 2, scoreSeniority: 4, personaName: null, scoredAt: recent },
      HOT_LEAD_DEFAULTS,
      NOW,
    );
    expect(a.hot).toBe(false);
    expect(a.reasons).toEqual([]);
  });

  it("does not promote a low score however strong the signal", () => {
    // Someone posting about the space who is junior at an out-of-profile
    // company is noise.
    expect(
      isHotLead({ ...HOT_BY_INTENT, fitScore: 50 }, HOT_LEAD_DEFAULTS, NOW),
    ).toBe(false);
  });

  it("treats an UNSCORED lead as not hot, and not as low", () => {
    const a = assessHotLead({ ...HOT_BY_INTENT, fitScore: null }, HOT_LEAD_DEFAULTS, NOW);
    expect(a.hot).toBe(false);
    expect(a.score).toBeNull();
  });

  it("requires an actual signal string, not just intent points", () => {
    // Points with no quotable signal give the rep nothing to open with, which
    // is the entire value of the intent path.
    expect(
      isHotLead({ ...HOT_BY_INTENT, intentSignal: null }, HOT_LEAD_DEFAULTS, NOW),
    ).toBe(false);
  });

  it("requires a matched persona for the authority path, not seniority alone", () => {
    expect(
      isHotLead({ ...HOT_BY_AUTHORITY, personaName: null }, HOT_LEAD_DEFAULTS, NOW),
    ).toBe(false);
  });

  it("reports BOTH reasons when both fire", () => {
    const a = assessHotLead({ ...HOT_BY_INTENT, ...HOT_BY_AUTHORITY, fitScore: 97 }, HOT_LEAD_DEFAULTS, NOW);
    expect(a.reasons.sort()).toEqual(["authority", "intent"]);
  });

  it("respects a custom threshold", () => {
    expect(isHotLead({ ...HOT_BY_INTENT, fitScore: 75 }, HOT_LEAD_DEFAULTS, NOW)).toBe(false);
    expect(
      isHotLead({ ...HOT_BY_INTENT, fitScore: 75 }, { ...HOT_LEAD_DEFAULTS, scoreThreshold: 70 }, NOW),
    ).toBe(true);
  });
});

describe("intent decay", () => {
  it("stops counting a stale signal", () => {
    // A post from three days ago predicts a reply; the same post from four
    // months ago is history. Treating them alike is what makes an intent
    // score meaningless over time.
    expect(intentIsFresh({ scoredAt: recent }, 30, NOW)).toBe(true);
    expect(intentIsFresh({ scoredAt: old }, 30, NOW)).toBe(false);
    expect(isHotLead({ ...HOT_BY_INTENT, scoredAt: old }, HOT_LEAD_DEFAULTS, NOW)).toBe(false);
  });

  it("falls back to updatedAt when there is no scoredAt", () => {
    expect(intentIsFresh({ updatedAt: old }, 30, NOW)).toBe(false);
    expect(intentIsFresh({ updatedAt: recent }, 30, NOW)).toBe(true);
  });

  it("treats a MISSING timestamp as fresh, not stale", () => {
    // The alternative silently excludes every lead scored before scoredAt was
    // populated, which would make the section look broken rather than empty.
    expect(intentIsFresh({}, 30, NOW)).toBe(true);
  });

  it("treats an unparseable timestamp as fresh rather than throwing", () => {
    expect(intentIsFresh({ scoredAt: "not-a-date" }, 30, NOW)).toBe(true);
  });
});

describe("sortHotLeads", () => {
  it("orders by score, breaking ties on intent", () => {
    // Between two leads at the same score, the one with live evidence of
    // interest is the one to contact first. An arbitrary tie-break would make
    // the top of the list feel random.
    const out = sortHotLeads([
      { fitScore: 90, scoreIntent: 5 },
      { fitScore: 95, scoreIntent: 1 },
      { fitScore: 90, scoreIntent: 20 },
    ]);
    expect(out.map((l) => [l.fitScore, l.scoreIntent])).toEqual([
      [95, 1],
      [90, 20],
      [90, 5],
    ]);
  });

  it("does not mutate its input", () => {
    const input = [{ fitScore: 1 }, { fitScore: 99 }];
    sortHotLeads(input);
    expect(input[0].fitScore).toBe(1);
  });
});

describe("describeHotReasons", () => {
  it("explains each reason in plain language", () => {
    expect(describeHotReasons(["intent"])).toMatch(/recently/);
    expect(describeHotReasons(["authority"])).toMatch(/decision/);
    expect(describeHotReasons(["intent", "authority"])).toContain("·");
  });
});

describe("thresholds are derived from the weights, not hard-coded", () => {
  it("scales with the intent and seniority weights", () => {
    // Change a weight and these follow, instead of silently becoming
    // impossible-to-reach or trivially-met constants.
    expect(MIN_INTENT_FOR_HOT).toBeGreaterThan(0);
    expect(MIN_INTENT_FOR_HOT).toBeLessThan(25);
    expect(MIN_SENIORITY_FOR_HOT).toBeGreaterThan(0);
    expect(MIN_SENIORITY_FOR_HOT).toBeLessThanOrEqual(20);
  });
});
