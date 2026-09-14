import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// The reveal action's shape and gate ORDER are the contract the UI depends on,
// and the order is load-bearing: checking the budget tier before the fit gate
// is what makes the "paused" message explain the real blocker instead of
// telling someone to improve a lead they cannot currently reveal anyway.
//
// Asserted against the source because the action's imports pull in the whole
// DB/secret stack, which is not worth standing up to check a policy ordering.
//
// The gates moved out of the action into revealPhoneForRecord when the Chrome
// extension needed the same capability -- a second copy of a hundred lines of
// spend policy is exactly how the enrichment logic drifted into spending 9
// credits per lead. The behaviour is unchanged, so these assertions read BOTH
// files: the action for its schema contract, the helper for the gate order.
const ACTION_SRC = readFileSync(new URL("../actions/reveal-phone.ts", import.meta.url), "utf8");
const HELPER_SRC = readFileSync(
  new URL("../server/helpers/reveal-phone-for-record.ts", import.meta.url),
  "utf8",
);
const SRC = `${ACTION_SRC}\n${HELPER_SRC}`;

function indexOfCode(code: string): number {
  const i = SRC.indexOf(`code: "${code}"`);
  expect(i, `expected a "${code}" branch`).toBeGreaterThan(-1);
  return i;
}

describe("reveal-phone — contract", () => {
  it("requires the client to echo the exact 8-credit cost", () => {
    // A stale client or a blind retry cannot spend by accident, and the price
    // is structurally part of the request rather than a number the server
    // hopes the UI displayed.
    expect(SRC).toContain("confirmCredits: z.literal(REVEAL_CREDITS)");
    expect(SRC).toMatch(/const REVEAL_CREDITS = 8/);
  });

  it("serves both tables from ONE action so the gate cannot drift", () => {
    expect(SRC).toContain('source: z.enum(["lead_list_item", "prospect"])');
  });

  it("requires auth and is not agent-exposed by default", () => {
    expect(SRC).toContain("requiresAuth: true");
    expect(SRC).not.toContain("publicAgent");
  });

  it("writes an audit entry that names the override", () => {
    expect(SRC).toContain("audit:");
    expect(SRC).toMatch(/OVERRIDE on a lead below the fit bar/);
  });

  it("charges for the match leg too, since the reveal rides on it", () => {
    // A reveal is only obtainable via /people/match, so the real cost is
    // 1 + 8 -- reporting 8 would understate it.
    expect(SRC).toContain("creditsCharged: REVEAL_CREDITS + 1");
  });
});

describe("reveal-phone — zero-spend short circuits come first", () => {
  it("refuses when a number is already stored", () => {
    expect(indexOfCode("already_revealed")).toBeGreaterThan(-1);
  });

  it("refuses while a reveal is already in flight", () => {
    // Apollo delivers asynchronously; paying again for a pending answer is
    // pure waste.
    expect(indexOfCode("reveal_pending")).toBeGreaterThan(-1);
  });

  it("refuses when Apollo has already said it holds no number", () => {
    // no_match means Apollo told us it has nothing. Paying 8 credits to be
    // told the same thing again is the most avoidable spend there is.
    expect(indexOfCode("no_number_known")).toBeGreaterThan(-1);
  });

  it("checks all three BEFORE reading the budget or reserving anything", () => {
    // The CALL SITE, not the import line at the top of the file.
    const budget = SRC.indexOf("await getEnrichmentBudgetState()");
    expect(indexOfCode("already_revealed")).toBeLessThan(budget);
    expect(indexOfCode("reveal_pending")).toBeLessThan(budget);
    expect(indexOfCode("no_number_known")).toBeLessThan(budget);
  });

  it("verifies ownership before anything else", () => {
    // A reveal spends SHARED credits, so it must not be triggerable against
    // someone else's lead.
    const ownership = SRC.indexOf('code: "not_found"');
    expect(ownership).toBeLessThan(SRC.indexOf("await getEnrichmentBudgetState()"));
  });
});

describe("reveal-phone — gate order", () => {
  it("checks the budget tier BEFORE the fit gate", () => {
    // Order matters for the message the user sees. If the fit gate ran first,
    // someone would be told to improve a lead when the real blocker is that
    // the workspace is out of credits.
    expect(indexOfCode("phone_budget_blocked")).toBeLessThan(indexOfCode("fit_gate"));
  });

  it("checks the hard stop before the phone pause", () => {
    expect(indexOfCode("budget_exhausted")).toBeLessThan(indexOfCode("phone_budget_blocked"));
  });

  it("checks the kill switch before any budget arithmetic", () => {
    expect(indexOfCode("apollo_disabled")).toBeLessThan(indexOfCode("budget_exhausted"));
  });

  it("fails closed when the accounting store is unreadable", () => {
    expect(indexOfCode("store_unavailable")).toBeGreaterThan(-1);
  });
});

describe("reveal-phone — the override", () => {
  it("only bypasses the FIT gate, never the budget", () => {
    // The 80% pause is a policy, not a nag. An override must not be able to
    // spend credits the workspace has already run out of -- which is why the
    // tier checks return before `override` is ever consulted.
    const override = SRC.indexOf("!clears && !override");
    expect(indexOfCode("phone_budget_blocked")).toBeLessThan(override);
    expect(indexOfCode("budget_exhausted")).toBeLessThan(override);
  });

  it("returns the verdict and reason so the UI can state them", () => {
    // The two-step confirmation says "Weak -- <the actual reason>", not a
    // generic warning, which is what makes the override an informed choice.
    expect(SRC).toContain("fitVerdict: row.fitVerdict ?? null");
    expect(SRC).toContain("fitReason: row.fitReason ?? null");
  });

  it("flags the spend as an override for the admin count", () => {
    expect(SRC).toContain("overrideFitGate: !clears && override");
    expect(SRC).toContain("wasOverride: !clears && override");
  });

  it("does not mark a spend as an override when the lead already cleared", () => {
    // `!clears && override` rather than just `override`: a client that always
    // sends override:true must not inflate the override count on leads that
    // never needed one.
    expect(SRC).not.toMatch(/overrideFitGate:\s*override\b/);
  });

  it("defaults override to false", () => {
    expect(SRC).toContain("override: z.boolean().default(false)");
  });
});
