import { readFileSync } from "node:fs";
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

describe("legacy stellar fallback", () => {
  // The first version required the new fitScore, which no existing lead has.
  // On a page of 257 already-scored-the-old-way prospects it therefore showed
  // nothing but "score these first" — a feature that only works after 257 LLM
  // calls does not work.

  it("promotes an UNSCORED lead that is stellar by the old signal", () => {
    // strong verdict + a persona matched in a separate earlier pass. Same
    // two-independent-signals idea the score-based rule uses, and what the
    // existing Stellar filter pill already runs on.
    const a = assessHotLead(
      { fitScore: null, fitVerdict: "strong", personaName: "Product" },
      HOT_LEAD_DEFAULTS,
      NOW,
    );
    expect(a.hot).toBe(true);
    expect(a.reasons).toEqual(["stellar"]);
    expect(a.score).toBeNull();
  });

  it("does not promote a strong verdict with no persona", () => {
    expect(
      isHotLead({ fitScore: null, fitVerdict: "strong", personaName: null }, HOT_LEAD_DEFAULTS, NOW),
    ).toBe(false);
  });

  it("promotes a human thumbs-up", () => {
    // leadQuality treats rating === 1 as stellar outright: if someone looked
    // at the lead and said yes, the model does not get to demote it.
    expect(
      isHotLead({ fitScore: null, fitVerdict: "weak", rating: 1 }, HOT_LEAD_DEFAULTS, NOW),
    ).toBe(true);
  });

  it("does not promote possible, weak or inconclusive", () => {
    for (const v of ["possible", "weak", "inconclusive"]) {
      expect(isHotLead({ fitScore: null, fitVerdict: v }, HOT_LEAD_DEFAULTS, NOW), v).toBe(false);
    }
  });

  it("does NOT fall back once a lead has a real score", () => {
    // A 30 must not sneak in on an old `strong` verdict. Otherwise the section
    // would get WORSE as scoring rolled out, which is backwards.
    const a = assessHotLead(
      { fitScore: 30, fitVerdict: "strong", personaName: "Product" },
      HOT_LEAD_DEFAULTS,
      NOW,
    );
    expect(a.hot).toBe(false);
    expect(a.reasons).toEqual([]);
  });

  it("ranks a scored lead above an unscored stellar one", () => {
    // The score is evidence; the legacy signal is an estimate.
    const out = sortHotLeads([
      { fitScore: null, fitVerdict: "strong", personaName: "P" },
      { fitScore: 88 },
    ]);
    expect(out[0].fitScore).toBe(88);
  });

  it("names the estimate as an estimate", () => {
    // Saying so is what makes rescoring an obvious next step rather than a
    // mystery.
    expect(describeHotReasons(["stellar"])).toMatch(/rescore/i);
  });
});

describe("the breakdown must not draw an unassessed dimension", () => {
  // Reported, and correct: the card showed "Intent signals 0/25" for a
  // lead-list lead that has no activity data at all. The scoring fix excluded
  // intent from the ARITHMETIC (87 of 75, not 65 of 100) but the UI still read
  // `scoreIntent ?? 0` and drew an empty bar — putting the "penalised for data
  // we never captured" message straight back, and worse: the number beside it
  // claimed the lead lost 25 points it never had a chance at.
  const SRC = readFileSync(
    new URL("../app/components/HotLeadsSection.tsx", import.meta.url),
    "utf8",
  );

  it("preserves null instead of coercing to zero", () => {
    // Matched as CODE, not prose: `?? 0` appears in the comment explaining
    // why it is wrong, so a bare substring check fails on the explanation.
    const code = SRC.split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");
    expect(code).toMatch(/roleFit: lead\.scoreRoleFit \?\? null/);
    expect(code).toMatch(/intent: lead\.scoreIntent \?\? null/);
    expect(code).not.toMatch(/lead\.score\w+ \?\? 0/);
  });

  it("omits unassessed dimensions rather than rendering them", () => {
    expect(SRC).toContain("values[d] !== null");
  });

  it("states the real denominator in the DETAIL view", () => {
    // An 87 from three signals must not read as an 87 from four. This belongs
    // in the sheet, not on the card, where it read as debug output.
    expect(SRC).toMatch(/of \{DIMENSION_ORDER\.length\} signals/);
  });

  it("the CARD uses one compact line, not full-width bars", () => {
    // Three full-width bars made the lead you are meant to scan the loudest
    // block on the page, and a 30/30 bar a thousand pixels wide says nothing
    // a hundred-pixel one does not.
    expect(SRC).toContain("export function ScoreChips");
    expect(SRC).toContain("<ScoreChips lead={lead} />");
    expect(SRC).not.toContain('<ScoreBreakdown lead={lead} className="mt-2" />');
  });

  it("clamps a verbose reason so it cannot set the card height", () => {
    expect(SRC).toContain("line-clamp-2");
  });

  it("explains WHY intent can be unassessable", () => {
    // Nothing in the app supplies activity for a Sales Nav list row:
    // recentActivity is only ever set by capture-profile, from the extension
    // reading a real profile page. Saying so is the honest version.
    expect(SRC).toContain("MISSING_HINT");
    expect(SRC).toMatch(/Sales Navigator list row carries no activity/);
  });
});

describe("the card explains the lead, not the rule", () => {
  const SRC = readFileSync(
    new URL("../app/components/HotLeadsSection.tsx", import.meta.url),
    "utf8",
  );

  it("shows fitReason, the model's actual evidence", () => {
    // The card was showing "decision-level in a matched persona", which
    // restates the promotion rule rather than explaining the lead.
    expect(SRC).toContain("{lead.fitReason}");
  });

  it("demotes the generic corroborator to a chip", () => {
    expect(SRC).not.toContain("{describeHotReasons(assessment.reasons)}");
  });
});

describe("clicking a lead breaks the score down", () => {
  it("the detail sheet renders the breakdown", () => {
    // Opening a lead used to show the rationale sentence and nothing else, so
    // there was no way to see which dimension the score came from — the exact
    // question a score invites.
    const SRC = readFileSync(new URL("../app/routes/_index.tsx", import.meta.url), "utf8");
    expect(SRC).toContain("<ScoreBreakdown lead={prospect}");
  });

  it("Prospect declares the score fields it actually receives", () => {
    // The interface was lying: the fields were present at runtime but absent
    // from the type, so the Hot Leads section type-checked only because its
    // own props are optional.
    const SRC = readFileSync(new URL("../app/routes/_index.tsx", import.meta.url), "utf8");
    for (const field of ["fitScore", "scoreRoleFit", "scoreIntent", "intentSignal"]) {
      expect(SRC, field).toMatch(new RegExp(`\\n  ${field}: `));
    }
  });
});

describe("fitReason is about the lead, not about our data", () => {
  it("forbids meta-commentary in the reason", () => {
    // A real reason came back as "...though no company-fit or intent evidence
    // is provided" — a caveat on OUR capture coverage, which tells a
    // salesperson nothing about the person. Telling the model which
    // dimensions to skip is what invited it.
    const SRC = readFileSync(new URL("../server/helpers/fit-score.ts", import.meta.url), "utf8");
    expect(SRC).toMatch(/Do NOT mention the missing evidence/);
    expect(SRC).toMatch(/scoring process in fitReason/);
  });
});
