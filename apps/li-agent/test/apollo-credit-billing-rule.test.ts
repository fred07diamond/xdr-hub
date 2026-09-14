import { beforeEach, describe, expect, it, vi } from "vitest";

// THE BILLING RULE: Apollo charges for data it actually delivers, not for
// being asked. Confirmed against the real account, and it replaces the earlier
// conservative assumption that a lookup billed on attempt.
//
// These tests pin the settle side of it. The DB is faked rather than the
// ledger module, because settleEnrichment reaches finalizeLedgerRow through a
// module-internal reference a mock cannot intercept -- and faking the layer
// beneath runs the real decision logic, which is the part worth testing.

let selectRows: unknown[] = [];
const updates: Array<{ id: unknown; values: Record<string, unknown> }> = [];

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
        where: async (w: unknown) => {
          updates.push({ id: w, values });
        },
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: async () => {},
        onConflictDoUpdate: async () => {},
      }),
    }),
    delete: () => ({ where: async () => {} }),
  }),
}));

const { settleEnrichment } = await import("../server/helpers/apollo-credits/guard.js");

/**
 * Builds an authorization by hand.
 *
 * `CreditAuthorization` is a branded type that deliberately cannot be
 * constructed outside guard.ts -- that is the guarantee making budget bypass a
 * compile error. A test double is the one legitimate exception, cast once here
 * rather than weakening the brand.
 */
function auth(legs: Array<{ unit: string; ledgerId: string; consumed: boolean }>) {
  return { legs, id: "test-auth" } as unknown as Parameters<typeof settleEnrichment>[0];
}

/** All settle writes, in order -- one per leg, so index maps to leg order. */
function writes() {
  return updates.map((u) => u.values);
}

beforeEach(() => {
  selectRows = [];
  updates.length = 0;
});

describe("settleEnrichment — person match", () => {
  it("charges nothing when Apollo matched nobody", async () => {
    await settleEnrichment(auth([{ unit: "person_match", ledgerId: "L1", consumed: true }]), {
      personMatch: { outcome: "no_match" },
    });
    const w = writes()[0];
    expect(w.actualCredits).toBe(0);
    expect(w.status).toBe("reconciled");
    expect(w.outcome).toBe("no_match");
  });

  it("charges nothing when Apollo matched the person but had no email", async () => {
    // The case that most looked like a bug in the UI and most looked like
    // wasted money on the gauge. It is neither: a complete answer, for free.
    await settleEnrichment(auth([{ unit: "person_match", ledgerId: "L1", consumed: true }]), {
      personMatch: { outcome: "match", apolloPersonId: "p1", revealedEmail: false },
    });
    const w = writes()[0];
    expect(w.actualCredits).toBe(0);
    expect(w.outcome).toBe("match_no_email");
    // Still records WHO it matched, so a later re-enrich or reveal can use it.
    expect(w.apolloPersonId).toBe("p1");
  });

  it("charges when an email actually came back", async () => {
    await settleEnrichment(auth([{ unit: "person_match", ledgerId: "L1", consumed: true }]), {
      personMatch: { outcome: "match", apolloPersonId: "p1", revealedEmail: true },
    });
    const w = writes()[0];
    // No actualCredits override: the reserved estimate of 1 stands.
    expect(w.actualCredits).toBeUndefined();
    expect(w.status).toBe("committed");
    expect(w.outcome).toBe("match_email");
  });

  it("VOIDS an http error -- a rejected request delivers nothing", async () => {
    await settleEnrichment(auth([{ unit: "person_match", ledgerId: "L1", consumed: true }]), {
      personMatch: { outcome: "http_error" },
    });
    expect(writes()[0].status).toBe("voided");
  });

  it("KEEPS a timeout charged, the one deliberate exception", async () => {
    // We genuinely cannot tell whether Apollo processed it, so we over-count
    // our own budget rather than risk overspending the real allocation.
    await settleEnrichment(auth([{ unit: "person_match", ledgerId: "L1", consumed: true }]), {
      personMatch: { outcome: "timeout" },
    });
    const w = writes()[0];
    expect(w.status).toBe("committed");
    expect(w.actualCredits).toBeUndefined();
    // Tagged so reprice can zero the whole class once an invoice settles it.
    expect(w.outcome).toBe("match_timeout");
  });

  it("voids a leg that was authorized but never actually called", async () => {
    await settleEnrichment(auth([{ unit: "person_match", ledgerId: "L1", consumed: false }]), {
      personMatch: { outcome: "match", revealedEmail: true },
    });
    expect(writes()[0].status).toBe("voided");
    expect(writes()[0].outcome).toBe("not_called");
  });
});

describe("settleEnrichment — phone reveal", () => {
  it("charges a synchronous reveal that produced a number", async () => {
    await settleEnrichment(auth([{ unit: "phone_reveal", ledgerId: "L2", consumed: true }]), {
      phoneReveal: { outcome: "resolved_sync", apolloPersonId: "p1", revealedPhone: true },
    });
    const w = writes()[0];
    expect(w.status).toBe("committed");
    expect(w.outcome).toBe("revealed_sync");
    expect(w.actualCredits).toBeUndefined();
  });

  it("charges nothing for a reveal that resolved with no number", async () => {
    await settleEnrichment(auth([{ unit: "phone_reveal", ledgerId: "L2", consumed: true }]), {
      phoneReveal: { outcome: "resolved_sync", apolloPersonId: "p1", revealedPhone: false },
    });
    const w = writes()[0];
    expect(w.actualCredits).toBe(0);
    expect(w.status).toBe("reconciled");
    expect(w.outcome).toBe("reveal_no_number");
  });

  it("holds all 8 credits while waiting for the webhook", async () => {
    // The webhook carries Apollo's authoritative credits_consumed (0 when it
    // found nothing), so the estimate must stand until it arrives -- releasing
    // early would let a second reveal spend the same 8.
    await settleEnrichment(auth([{ unit: "phone_reveal", ledgerId: "L2", consumed: true }]), {
      phoneReveal: { outcome: "requested", apolloPersonId: "p1" },
    });
    const w = writes()[0];
    expect(w.status).toBe("pending_webhook");
    expect(w.actualCredits).toBeUndefined();
  });

  it("voids a reveal that was never requested", async () => {
    await settleEnrichment(auth([{ unit: "phone_reveal", ledgerId: "L2", consumed: true }]), {
      phoneReveal: { outcome: "not_requested" },
    });
    expect(writes()[0].status).toBe("voided");
  });
});

describe("settleEnrichment — both legs together", () => {
  it("settles a match+reveal call independently per leg", async () => {
    // One Apollo call, two billable units. A found email with no phone must
    // charge 1 and not 9.
    await settleEnrichment(
      auth([
        { unit: "person_match", ledgerId: "L1", consumed: true },
        { unit: "phone_reveal", ledgerId: "L2", consumed: true },
      ]),
      {
        personMatch: { outcome: "match", apolloPersonId: "p1", revealedEmail: true },
        phoneReveal: { outcome: "resolved_sync", apolloPersonId: "p1", revealedPhone: false },
      },
    );
    const [match, reveal] = writes();
    expect(match.status).toBe("committed");
    expect(match.actualCredits).toBeUndefined();
    expect(reveal.actualCredits).toBe(0);
  });

  it("never throws, whatever the bookkeeping does", async () => {
    // A ledger write failure must not mask the enrichment result the caller is
    // about to return.
    await expect(
      settleEnrichment(auth([{ unit: "person_match", ledgerId: "L1", consumed: true }]), {}),
    ).resolves.toBeUndefined();
  });
});
