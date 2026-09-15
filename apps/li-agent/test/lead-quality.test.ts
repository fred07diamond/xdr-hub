import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  isBulkEligibleQuality,
  isHighValue,
  leadQuality,
  qualityRank,
  sortByQuality,
} from "../app/lib/lead-quality.js";
import {
  BULK_HALT_CODES,
  BULK_MAX_CONSECUTIVE_FAILURES,
  CREDITS_PER_EMAIL,
  CREDITS_PER_PHONE_REVEAL,
  describeHalt,
  MAX_BULK_ENRICH,
} from "../app/lib/apollo-limits.js";

describe("leadQuality", () => {
  it("treats a human thumbs-up as stellar, outranking the model", () => {
    // If someone looked at the lead and said yes, the model does not get to
    // demote it.
    expect(leadQuality({ rating: 1, fitVerdict: "weak" })).toBe("stellar");
  });

  it("requires TWO independent signals for stellar", () => {
    // `strong` alone is one LLM judgment. `strong` + a matched persona means
    // two separate passes concurred -- persona is assigned at import from the
    // headline, before any scoring.
    expect(leadQuality({ fitVerdict: "strong", personaName: "Product" })).toBe("stellar");
    expect(leadQuality({ fitVerdict: "strong", personaName: null })).toBe("good");
  });

  it("ranks possible as ok and weak as low", () => {
    expect(leadQuality({ fitVerdict: "possible", personaName: "Product" })).toBe("ok");
    expect(leadQuality({ fitVerdict: "weak", personaName: "Product" })).toBe("low");
  });

  it("maps inconclusive to unscored, NEVER low", () => {
    // `inconclusive` means "no ICP document uploaded", not "bad lead".
    // Treating it as low would hide every lead in a workspace that has not
    // uploaded criteria yet.
    expect(leadQuality({ fitVerdict: "inconclusive" })).toBe("unscored");
    expect(leadQuality({ fitVerdict: "inconclusive" })).not.toBe("low");
  });

  it("maps an unscored lead to unscored", () => {
    expect(leadQuality({})).toBe("unscored");
    expect(leadQuality({ fitVerdict: null })).toBe("unscored");
  });

  it("ignores a thumbs-down rather than treating it as a signal", () => {
    // rating === -1 is not currently used to demote: the verdict already
    // carries that, and double-counting would be opaque.
    expect(leadQuality({ rating: -1, fitVerdict: "strong", personaName: "P" })).toBe("stellar");
  });
});

describe("sortByQuality", () => {
  it("orders stellar first and low last", () => {
    const rows = [
      { id: "weak", fitVerdict: "weak" },
      { id: "unscored" },
      { id: "stellar", fitVerdict: "strong", personaName: "P" },
      { id: "ok", fitVerdict: "possible" },
      { id: "good", fitVerdict: "strong" },
    ];
    expect(sortByQuality(rows).map((r) => r.id)).toEqual([
      "stellar",
      "good",
      "ok",
      "unscored",
      "weak",
    ]);
  });

  it("ranks unscored ABOVE weak", () => {
    // A lead nobody scored may well be good; a lead explicitly scored weak
    // has been judged. So truncation should keep the unknown over the known-bad.
    expect(qualityRank({})).toBeLessThan(qualityRank({ fitVerdict: "weak" }));
  });

  it("does not mutate its input", () => {
    const rows = [{ id: "a", fitVerdict: "weak" }, { id: "b", fitVerdict: "strong", personaName: "P" }];
    const before = rows.map((r) => r.id);
    sortByQuality(rows);
    expect(rows.map((r) => r.id)).toEqual(before);
  });

  it("is stable enough to make truncation meaningful", () => {
    // The batch cap keeps the FIRST N after sorting, so if the cap discards
    // most of a selection the survivors must be the best ones rather than
    // whichever sat at the top of the Sales Nav order.
    const rows = Array.from({ length: 60 }, (_, i) =>
      i === 59 ? { id: "late-stellar", fitVerdict: "strong", personaName: "P" } : { id: `weak-${i}`, fitVerdict: "weak" },
    );
    expect(sortByQuality(rows).slice(0, 1).map((r) => r.id)).toEqual(["late-stellar"]);
  });
});

describe("isHighValue / isBulkEligibleQuality", () => {
  it("counts stellar and good as high value", () => {
    expect(isHighValue({ fitVerdict: "strong", personaName: "P" })).toBe(true);
    expect(isHighValue({ fitVerdict: "strong" })).toBe(true);
    expect(isHighValue({ fitVerdict: "possible" })).toBe(false);
  });

  it("excludes only an explicit weak verdict from bulk eligibility", () => {
    expect(isBulkEligibleQuality({ fitVerdict: "weak" })).toBe(false);
    expect(isBulkEligibleQuality({ fitVerdict: "possible" })).toBe(true);
  });

  it("INCLUDES unscored leads in bulk eligibility", () => {
    // Excluding them would mean a freshly imported list had nothing eligible
    // at all, which reads as a broken feature.
    expect(isBulkEligibleQuality({})).toBe(true);
    expect(isBulkEligibleQuality({ fitVerdict: "inconclusive" })).toBe(true);
  });
});

describe("apollo-limits", () => {
  it("keeps 50 as the DEFAULT batch size, not a ceiling", () => {
    // It was a hard cap on RECORDS, which is the wrong unit: 50 emails is 50
    // credits while 50 phone reveals is 400. Both spend surfaces now derive
    // the ceiling from remaining credits and let the user set the count, so
    // this is only the default for callers that pass nothing.
    expect(MAX_BULK_ENRICH).toBe(50);
  });

  it("no spend surface treats it as a hard cap any more", () => {
    // The export modal and the table's confirm both budget in credits now. A
    // record cap reappearing there would silently override a typed count.
    for (const path of ["app/components/CsvExportModal.tsx", "app/components/EnrichCostConfirm.tsx"]) {
      const src = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
      const code = src.split("\n").filter((l) => !/^\s*(\*|\/\/)/.test(l)).join("\n");
      expect(code, path).not.toContain("MAX_BULK_ENRICH");
    }
  });

  it("mirrors Apollo's 8:1 cost asymmetry", () => {
    expect(CREDITS_PER_EMAIL).toBe(1);
    expect(CREDITS_PER_PHONE_REVEAL).toBe(8);
  });

  it("treats every budget refusal as a reason to STOP the loop", () => {
    // Both loops used to catch-and-continue, so a budget block produced 50
    // silent no-ops and the user was told nothing.
    for (const code of [
      "budget_exhausted",
      "user_cap_exhausted",
      "phone_budget_blocked",
      "apollo_disabled",
      "store_unavailable",
      "rate_limited",
    ]) {
      expect(BULK_HALT_CODES.has(code)).toBe(true);
    }
  });

  it("does not halt on a per-lead data problem", () => {
    // A lead with no name is one bad row, not a reason to abandon the run.
    expect(BULK_HALT_CODES.has("not_found")).toBe(false);
    expect(BULK_HALT_CODES.has("already_revealed")).toBe(false);
  });

  it("also stops after repeated consecutive failures", () => {
    // A systemic outage (Apollo down, key revoked) should not hammer through
    // the whole selection.
    expect(BULK_MAX_CONSECUTIVE_FAILURES).toBe(3);
  });

  it("explains every halt code in plain language", () => {
    for (const code of BULK_HALT_CODES) {
      const msg = describeHalt(code);
      expect(msg.length).toBeGreaterThan(10);
      // Must not leak the raw code to the user.
      expect(msg).not.toContain("_");
    }
    expect(describeHalt("repeated_failure")).toMatch(/failed in a row/i);
  });

  it("falls back to a supplied message for an unknown code", () => {
    expect(describeHalt("something_new", "Server said no.")).toBe("Server said no.");
    expect(describeHalt("something_new")).toBeTruthy();
  });
});
