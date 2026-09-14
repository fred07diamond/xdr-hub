import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApolloCreditSettings } from "../server/helpers/apollo-credits/settings.js";
import type { SpendBreakdown } from "../server/helpers/apollo-credits/ledger.js";

// The guard is pure policy: settings in, ledger writes out. Both dependencies
// are stubbed so every branch can be driven deterministically. verdictClearsBar
// is the REAL implementation (it is policy, not I/O) so the fit gate is tested
// for real rather than against a stub that agrees with itself.

let settings: ApolloCreditSettings;
let breakdown: SpendBreakdown;
let userSpend = 0;
let userLimit = 2_000;
let settingsThrows = false;
let userLookupThrows = false;
let inserted: Array<Record<string, unknown>> = [];
let finalized: Array<{ ledgerId: string; patch: Record<string, unknown> }> = [];

vi.mock("../server/helpers/apollo-credits/settings.js", async () => {
  const actual = await vi.importActual<typeof import("../server/helpers/apollo-credits/settings.js")>(
    "../server/helpers/apollo-credits/settings.js",
  );
  return {
    ...actual,
    getApolloCreditSettings: async () => {
      if (settingsThrows) throw new Error("db down");
      return settings;
    },
  };
});

vi.mock("../server/helpers/apollo-credits/ledger.js", async () => {
  const actual = await vi.importActual<typeof import("../server/helpers/apollo-credits/ledger.js")>(
    "../server/helpers/apollo-credits/ledger.js",
  );
  return {
    ...actual,
    getPeriodSpend: async () => breakdown,
    getUserPeriodSpend: async () => userSpend,
    insertReservation: async (input: Record<string, unknown>) => {
      inserted.push(input);
      return `ledger_${inserted.length}`;
    },
    finalizeLedgerRow: async (ledgerId: string, patch: Record<string, unknown>) => {
      finalized.push({ ledgerId, patch });
    },
  };
});

vi.mock("../server/helpers/apollo-credits/user-limits.js", () => ({
  getUserCreditLimit: async () => {
    if (userLookupThrows) throw new Error("db down");
    return userLimit;
  },
}));

const { APOLLO_CREDIT_DEFAULTS } = await import("../server/helpers/apollo-credits/settings.js");
const {
  claimLeg,
  getEnrichmentBudgetState,
  reserveEnrichment,
  settleEnrichment,
} = await import("../server/helpers/apollo-credits/guard.js");

function spend(total: number, opts: Partial<SpendBreakdown> = {}): SpendBreakdown {
  return {
    total,
    byUnit: { person_match: total, phone_reveal: 0, org_enrich: 0 },
    countByUnit: { person_match: total, phone_reveal: 0, org_enrich: 0 },
    byTrigger: { manual: total, sweep: 0, agent: 0 },
    overrideCredits: 0,
    overrideCount: 0,
    ...opts,
  };
}

const MANUAL = {
  trigger: "manual" as const,
  actorEmail: "xdr@builder.io",
  subjectTable: "lead_list_items" as const,
  subjectId: "lead_1",
};

beforeEach(() => {
  settings = { ...APOLLO_CREDIT_DEFAULTS, enabled: true, periodBudget: 1_000, safetyMargin: 0 };
  breakdown = spend(0);
  userSpend = 0;
  userLimit = 2_000;
  settingsThrows = false;
  userLookupThrows = false;
  inserted = [];
  finalized = [];
});

describe("reserveEnrichment — fail-closed gates", () => {
  it("denies when enrichment is switched off", async () => {
    settings.enabled = false;
    const r = await reserveEnrichment(MANUAL);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("disabled");
    expect(inserted).toHaveLength(0);
  });

  it("denies when the accounting store is unreadable", async () => {
    // The critical one: a DB outage must not become an unmetered spending
    // window. This is deliberately the opposite of isOverDailyLimit's
    // fail-open behaviour, because the downside here is money.
    settingsThrows = true;
    const r = await reserveEnrichment(MANUAL);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("store_unavailable");
      expect(r.state).toBeNull();
    }
    expect(inserted).toHaveLength(0);
  });

  it("denies when the per-user lookup fails, rather than skipping the cap", async () => {
    userLookupThrows = true;
    const r = await reserveEnrichment(MANUAL);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("store_unavailable");
    expect(inserted).toHaveLength(0);
  });

  it("denies once the period budget is spent", async () => {
    breakdown = spend(1_000);
    const r = await reserveEnrichment(MANUAL);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("period_exhausted");
  });

  it("refuses the last credits so the safety margin absorbs concurrent overshoot", async () => {
    settings.safetyMargin = 200;
    breakdown = spend(800); // spendable is 1000 - 200
    const r = await reserveEnrichment(MANUAL);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("period_exhausted");
  });

  it("names the reset date in every denial message so the user knows when it clears", async () => {
    breakdown = spend(1_000);
    const r = await reserveEnrichment(MANUAL);
    if (!r.ok) expect(r.message).toMatch(/reset/i);
  });
});

describe("reserveEnrichment — happy path", () => {
  it("reserves one credit for an email-only enrich", async () => {
    const r = await reserveEnrichment(MANUAL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.revealPhone).toBe(false);
    expect(r.auth.legs).toHaveLength(1);
    expect(r.auth.legs[0].unit).toBe("person_match");
    expect(inserted[0]).toMatchObject({ unit: "person_match", trigger: "manual", actorEmail: "xdr@builder.io" });
  });

  it("records the verdict at spend time, so history can't be rewritten by a re-score", async () => {
    await reserveEnrichment({ ...MANUAL, fitVerdict: "strong" });
    expect(inserted[0]).toMatchObject({ fitVerdict: "strong" });
  });

  it("stores an unrecognized verdict as null instead of casting it through", async () => {
    await reserveEnrichment({ ...MANUAL, fitVerdict: "excellent" });
    expect(inserted[0]).toMatchObject({ fitVerdict: null });
  });

  it("adds an org-enrich leg at zero cost but still records it", async () => {
    // Recorded so that if org enrich turns out to bill, the call counts exist
    // to reprice against rather than being absent from history.
    const r = await reserveEnrichment(MANUAL, { wantOrgEnrich: true });
    expect(r.ok).toBe(true);
    expect(inserted.map((i) => i.unit)).toEqual(["person_match", "org_enrich"]);
  });
});

describe("reserveEnrichment — the 8-credit phone gate", () => {
  it("reserves 8 extra credits for a strong-fit reveal", async () => {
    const r = await reserveEnrichment({ ...MANUAL, fitVerdict: "strong" }, { wantPhoneReveal: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.revealPhone).toBe(true);
    expect(inserted.map((i) => i.unit)).toEqual(["person_match", "phone_reveal"]);
  });

  it("blocks a reveal on a weak lead", async () => {
    const r = await reserveEnrichment({ ...MANUAL, fitVerdict: "weak" }, { wantPhoneReveal: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("fit_gate");
    expect(inserted).toHaveLength(0);
  });

  it("blocks a reveal on an unscored lead", async () => {
    const r = await reserveEnrichment(MANUAL, { wantPhoneReveal: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("fit_gate");
  });

  it("allows a weak-lead reveal ONLY with an explicit override, and flags it", async () => {
    const r = await reserveEnrichment(
      { ...MANUAL, fitVerdict: "weak" },
      { wantPhoneReveal: true, overrideFitGate: true },
    );
    expect(r.ok).toBe(true);
    const revealRow = inserted.find((i) => i.unit === "phone_reveal");
    // The flag an admin watches to see whether the gate is being respected.
    expect(revealRow).toMatchObject({ isOverride: true });
    // The 1-credit match leg is never marked as an override.
    expect(inserted.find((i) => i.unit === "person_match")).toMatchObject({ isOverride: false });
  });

  it("drops the reveal leg but KEEPS the email once phones are paused", async () => {
    // Tiered degradation: the expensive leg goes first and the caller is told,
    // rather than the whole enrich failing.
    breakdown = spend(850); // past the 80% phone stop, below the 100% hard stop
    const r = await reserveEnrichment({ ...MANUAL, fitVerdict: "strong" }, { wantPhoneReveal: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.revealPhone).toBe(false);
    expect(r.phoneRevealSkippedReason).toBe("budget_paused");
    expect(inserted.map((i) => i.unit)).toEqual(["person_match"]);
  });

  it("does not let an override bypass the paused-phone tier", async () => {
    // The 80% pause is a policy, not a nag: an override is for the fit gate,
    // not for spending credits the workspace has already run out of.
    breakdown = spend(850);
    const r = await reserveEnrichment(
      { ...MANUAL, fitVerdict: "weak" },
      { wantPhoneReveal: true, overrideFitGate: true },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.revealPhone).toBe(false);
    expect(inserted.some((i) => i.unit === "phone_reveal")).toBe(false);
  });

  it("checks the FULL multi-leg cost, so a 9-credit enrich can't straddle the line", async () => {
    // Reaching this check requires the phone tier NOT to have paused reveals
    // already: with the default 80% stop, a spend high enough to straddle the
    // line has long since dropped the reveal leg. It becomes reachable when an
    // admin sets the stop to 100%, i.e. opts out of tiered degradation.
    settings.phoneStopPct = 100;
    breakdown = spend(995); // room for 1 credit but not for 1 + 8
    const r = await reserveEnrichment({ ...MANUAL, fitVerdict: "strong" }, { wantPhoneReveal: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("period_exhausted");
    expect(inserted).toHaveLength(0);
  });

  it("the phone tier normally pre-empts the straddle case entirely", async () => {
    // Documents the interaction above: at the default 80% stop, a near-budget
    // spend yields an email-only enrich rather than a denial, which is the
    // better outcome for the user.
    breakdown = spend(995);
    const r = await reserveEnrichment({ ...MANUAL, fitVerdict: "strong" }, { wantPhoneReveal: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.revealPhone).toBe(false);
    expect(r.phoneRevealSkippedReason).toBe("budget_paused");
  });
});

describe("reserveEnrichment — sweep containment", () => {
  const SWEEP = { trigger: "sweep" as const, actorEmail: null, subjectTable: "lead_list_items" as const, subjectId: "lead_1" };

  it("caps automatic spend at its configured share", async () => {
    breakdown = spend(500, { byTrigger: { manual: 0, sweep: 500, agent: 0 } }); // sweepCap is 50% of 1000
    const r = await reserveEnrichment({ ...SWEEP, fitVerdict: "strong" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("sweep_reserve_exhausted");
  });

  it("leaves credits for manual work once the sweep is capped", async () => {
    breakdown = spend(500, { byTrigger: { manual: 0, sweep: 500, agent: 0 } });
    const r = await reserveEnrichment(MANUAL);
    expect(r.ok).toBe(true);
  });

  it("does not apply a personal cap to sweep spend", async () => {
    // Sweep rows carry no actor, so automatic spend belongs to the workspace
    // rather than to whoever's request happened to carry the tick.
    userLimit = 0;
    const r = await reserveEnrichment({ ...SWEEP, fitVerdict: "strong" });
    expect(r.ok).toBe(true);
    expect(inserted[0]).toMatchObject({ actorEmail: null, trigger: "sweep" });
  });
});

describe("reserveEnrichment — per-user allowance", () => {
  it("blocks a user who has spent their allowance", async () => {
    userLimit = 100;
    userSpend = 100;
    const r = await reserveEnrichment(MANUAL);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("user_cap_exhausted");
      expect(r.message).toContain("100");
    }
  });

  it("blocks a reveal that would push the user past their allowance", async () => {
    userLimit = 100;
    userSpend = 95; // room for 1 credit, not for 9
    const r = await reserveEnrichment({ ...MANUAL, fitVerdict: "strong" }, { wantPhoneReveal: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("user_cap_exhausted");
  });

  it("does not block other users when one is capped", async () => {
    userLimit = 5_000;
    userSpend = 10;
    const r = await reserveEnrichment({ ...MANUAL, actorEmail: "other@builder.io" });
    expect(r.ok).toBe(true);
  });

  it("applies the personal cap to agent-triggered spend too", async () => {
    // The enrich actions are agent-tool-callable, so the agent can loop them.
    userLimit = 0;
    const r = await reserveEnrichment({ ...MANUAL, trigger: "agent" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("user_cap_exhausted");
  });
});

describe("claimLeg — the apolloFetch interlock", () => {
  it("claims a matching unconsumed leg", async () => {
    const r = await reserveEnrichment(MANUAL);
    if (!r.ok) throw new Error("expected reservation");
    const leg = claimLeg(r.auth, "person_match");
    expect(leg.consumed).toBe(true);
  });

  it("refuses a second call funded by the same leg", async () => {
    // A replayed authorization must not be able to buy two Apollo calls.
    const r = await reserveEnrichment(MANUAL);
    if (!r.ok) throw new Error("expected reservation");
    claimLeg(r.auth, "person_match");
    expect(() => claimLeg(r.auth, "person_match")).toThrow(/not authorized/i);
  });

  it("refuses a unit that was never reserved", async () => {
    // The guarantee that makes bypassing the budget impossible: asking Apollo
    // for a phone reveal with only an email reservation fails loudly.
    const r = await reserveEnrichment(MANUAL);
    if (!r.ok) throw new Error("expected reservation");
    expect(() => claimLeg(r.auth, "phone_reveal")).toThrow(/not authorized/i);
  });
});

describe("settleEnrichment", () => {
  async function authFor(opts: Parameters<typeof reserveEnrichment>[1] = {}, verdict = "strong") {
    const r = await reserveEnrichment({ ...MANUAL, fitVerdict: verdict }, opts);
    if (!r.ok) throw new Error("expected reservation");
    return r.auth;
  }

  it("commits a successful match", async () => {
    const auth = await authFor();
    claimLeg(auth, "person_match");
    await settleEnrichment(auth, { personMatch: { outcome: "match", apolloPersonId: "apollo_1" } });
    expect(finalized[0].patch).toMatchObject({ status: "committed", outcome: "match", apolloPersonId: "apollo_1" });
  });

  it("KEEPS a no-match charged", async () => {
    // Assumption: Apollo bills an attempt even when it finds nobody. Tagged so
    // it can be repriced in bulk if an invoice says otherwise.
    const auth = await authFor();
    claimLeg(auth, "person_match");
    await settleEnrichment(auth, { personMatch: { outcome: "no_match" } });
    expect(finalized[0].patch).toMatchObject({ status: "committed", outcome: "no_match" });
  });

  it("VOIDS an HTTP error, refunding the budget", async () => {
    const auth = await authFor();
    claimLeg(auth, "person_match");
    await settleEnrichment(auth, { personMatch: { outcome: "http_error" } });
    expect(finalized[0].patch).toMatchObject({ status: "voided", outcome: "http_error" });
  });

  it("KEEPS a timeout charged, because the request may have been processed", async () => {
    const auth = await authFor();
    claimLeg(auth, "person_match");
    await settleEnrichment(auth, { personMatch: { outcome: "timeout" } });
    expect(finalized[0].patch).toMatchObject({ status: "committed", outcome: "timeout" });
  });

  it("holds a requested reveal as pending_webhook with its person id", async () => {
    const auth = await authFor({ wantPhoneReveal: true });
    claimLeg(auth, "person_match");
    claimLeg(auth, "phone_reveal");
    await settleEnrichment(auth, {
      personMatch: { outcome: "match", apolloPersonId: "apollo_1" },
      phoneReveal: { outcome: "requested", apolloPersonId: "apollo_1" },
    });
    const reveal = finalized.find((f) => f.ledgerId === "ledger_2");
    // Holds all 8 credits until Apollo's webhook reports the real cost.
    expect(reveal?.patch).toMatchObject({ status: "pending_webhook", apolloPersonId: "apollo_1" });
  });

  it("voids a leg that was reserved but never actually called", async () => {
    // Guards the case where a later step throws before the HTTP call: the
    // reservation must not keep consuming budget.
    const auth = await authFor({ wantPhoneReveal: true });
    claimLeg(auth, "person_match");
    await settleEnrichment(auth, { personMatch: { outcome: "match" } });
    const reveal = finalized.find((f) => f.ledgerId === "ledger_2");
    expect(reveal?.patch).toMatchObject({ status: "voided" });
  });

  it("settles every leg even if one write throws", async () => {
    const auth = await authFor({ wantPhoneReveal: true });
    claimLeg(auth, "person_match");
    claimLeg(auth, "phone_reveal");
    let calls = 0;
    const mod = await import("../server/helpers/apollo-credits/ledger.js");
    const spy = vi.spyOn(mod, "finalizeLedgerRow").mockImplementation(async () => {
      calls++;
      if (calls === 1) throw new Error("write failed");
    });
    await expect(
      settleEnrichment(auth, {
        personMatch: { outcome: "match" },
        phoneReveal: { outcome: "requested" },
      }),
    ).resolves.toBeUndefined();
    expect(calls).toBe(2);
    spy.mockRestore();
  });
});

describe("getEnrichmentBudgetState", () => {
  it("reports the tier ladder as spend rises", async () => {
    breakdown = spend(0);
    expect((await getEnrichmentBudgetState()).tier).toBe("ok");
    breakdown = spend(799);
    expect((await getEnrichmentBudgetState()).tier).toBe("ok");
    breakdown = spend(800); // 80%
    expect((await getEnrichmentBudgetState()).tier).toBe("phone_blocked");
    breakdown = spend(1_000);
    expect((await getEnrichmentBudgetState()).tier).toBe("hard_stop");
  });

  it("never reports negative remaining", async () => {
    breakdown = spend(5_000);
    const s = await getEnrichmentBudgetState();
    expect(s.remaining).toBe(0);
    expect(s.spentPct).toBe(100);
  });

  it("treats a zero budget as fully spent rather than dividing by zero", async () => {
    settings.periodBudget = 0;
    breakdown = spend(0);
    const s = await getEnrichmentBudgetState();
    expect(s.spentPct).toBe(100);
    expect(s.tier).toBe("hard_stop");
  });
});
