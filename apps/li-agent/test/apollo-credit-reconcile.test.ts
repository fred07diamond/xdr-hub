import { beforeEach, describe, expect, it, vi } from "vitest";

// Reconciliation is where Apollo's own `credits_consumed` replaces our
// estimate. The DB is stubbed so each branch can be driven directly.

// The DB is faked rather than the ledger module: reconcileRevealCredits calls
// findOpenRevealByPersonId and finalizeLedgerRow as module-internal
// references, which a module mock cannot intercept. Faking the layer beneath
// runs the REAL reconciliation logic, which is what we want to pin anyway.
let selectRows: unknown[] = [];
let updates: Array<Record<string, unknown>> = [];

/** A thenable that accepts any drizzle chain and resolves to `rows`. */
function chain(rows: () => unknown[]) {
  const obj: Record<string, unknown> = {};
  for (const method of ["from", "where", "orderBy", "limit", "groupBy"]) {
    obj[method] = () => obj;
  }
  obj.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(rows()).then(res, rej);
  return obj;
}

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => chain(() => selectRows),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push(values);
        },
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: async () => {},
        onConflictDoUpdate: async () => {},
      }),
    }),
  }),
}));

const {
  COUNTED_STATUSES,
  MAX_RECONCILED_REVEAL_CREDITS,
  UNIT_COST,
  reconcileRevealCredits,
} = await import("../server/helpers/apollo-credits/ledger.js");

/** The one row findOpenRevealByPersonId will return. */
function openReservation() {
  selectRows = [{ id: "ledger_1", estimatedCredits: 8, subjectTable: "prospects", subjectId: "p1" }];
}

beforeEach(() => {
  openReservation();
  updates = [];
});

describe("reconcileRevealCredits", () => {
  it("applies Apollo's reported cost to the reservation", async () => {
    const r = await reconcileRevealCredits("apollo_1", 8, "revealed");
    expect(r).toBe("reconciled");
    expect(updates[0]).toMatchObject({ status: "reconciled", outcome: "revealed", actualCredits: 8 });
  });

  it("refunds the budget when Apollo reports it charged nothing", async () => {
    // The entire point of reconciling rather than trusting the estimate:
    // COALESCE(actual, estimated) means a 0 here releases all 8 credits with
    // no separate refund path.
    await reconcileRevealCredits("apollo_1", 0, "reveal_no_match");
    expect(updates[0]).toMatchObject({ actualCredits: 0, outcome: "reveal_no_match" });
  });

  it("leaves the estimate standing when the payload carries no cost", async () => {
    // Null keeps COALESCE falling back to the reserved 8 -- the conservative
    // direction when Apollo tells us nothing.
    await reconcileRevealCredits("apollo_1", null, "revealed");
    expect(updates[0]).toMatchObject({ actualCredits: null });
    expect(String(updates[0].note)).toContain("no credits_consumed");
  });

  it("CLAMPS an inflated cost, so a forged payload can't hard-stop the workspace", async () => {
    // This endpoint is requiresAuth:false and publicly reachable, so
    // credits_consumed is untrusted input. Unclamped, a forged
    // `credits_consumed: 9999999` would exhaust the period budget and block
    // enrichment for everyone -- a self-inflicted denial of service.
    await reconcileRevealCredits("apollo_1", 9_999_999, "revealed");
    expect(updates[0].actualCredits).toBe(MAX_RECONCILED_REVEAL_CREDITS);
    expect(MAX_RECONCILED_REVEAL_CREDITS).toBe(8);
  });

  it("floors a negative cost at zero rather than crediting us", async () => {
    await reconcileRevealCredits("apollo_1", -50, "revealed");
    expect(updates[0].actualCredits).toBe(0);
  });

  it("truncates a fractional cost", async () => {
    await reconcileRevealCredits("apollo_1", 3.9, "revealed");
    expect(updates[0].actualCredits).toBe(3);
  });

  it("ignores a non-finite cost", async () => {
    await reconcileRevealCredits("apollo_1", Number.NaN, "revealed");
    expect(updates[0].actualCredits).toBeNull();
  });

  it("writes NOTHING when there is no open reservation", async () => {
    // Either an earlier delivery already settled it, or the payload is for a
    // reveal this app never requested. An unauthenticated endpoint must not be
    // able to create new spend rows.
    selectRows = [];
    const r = await reconcileRevealCredits("apollo_unknown", 8, "revealed");
    expect(r).toBe("no_open_reservation");
    expect(updates).toHaveLength(0);
  });

  it("records the raw reported value for later auditing", async () => {
    // So a clamped or surprising number can be compared against a real
    // invoice rather than being silently normalised away.
    await reconcileRevealCredits("apollo_1", 9_999_999, "revealed");
    expect(String(updates[0].note)).toContain("9999999");
  });
});

describe("UNIT_COST", () => {
  it("prices a reveal at 8x an email", async () => {
    // The asymmetry the whole feature exists to manage.
    expect(UNIT_COST.person_match).toBe(1);
    expect(UNIT_COST.phone_reveal).toBe(8);
    expect(UNIT_COST.org_enrich).toBe(0);
  });
});

describe("COUNTED_STATUSES", () => {
  it("counts reservations, so concurrent requests can see each other", async () => {
    // Excluding `reserved` would let N simultaneous authorizations each read
    // the same pre-spend total and all pass.
    expect(COUNTED_STATUSES).toContain("reserved");
    expect(COUNTED_STATUSES).toContain("pending_webhook");
  });

  it("does NOT count voided rows -- that is the refund path", async () => {
    expect(COUNTED_STATUSES).not.toContain("voided");
  });
});
