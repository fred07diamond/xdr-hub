import { beforeEach, describe, expect, it, vi } from "vitest";

// enrichApolloRecord takes `db` as a parameter, so the DB is a plain fake that
// records what was written -- no module mocking needed for it. Only the Apollo
// client is stubbed.

let matchResult: unknown = null;
let matchThrows: Error | null = null;
let orgResult: unknown = null;
let orgThrows: Error | null = null;
let extractedPhone: string | null = null;
const matchCalls: Array<Record<string, unknown>> = [];

vi.mock("../server/helpers/apollo-client.js", () => ({
  matchApolloPerson: async (opts: Record<string, unknown>) => {
    matchCalls.push(opts);
    if (matchThrows) throw matchThrows;
    return matchResult;
  },
  enrichApolloOrganization: async () => {
    if (orgThrows) throw orgThrows;
    return orgResult;
  },
  extractApolloPhone: () => extractedPhone,
}));

// The credit guard is stubbed so this file tests the ENRICHMENT logic.
// The guard's own policy has its own suite (apollo-credit-guard.test.ts).
let reserveOk = true;
let reserveBlocked: { reason: string; message: string } = {
  reason: "period_exhausted",
  message: "Out of credits.",
};
let grantReveal: boolean | null = null; // null = honour what was requested
let reserveCalls: Array<{ ctx: Record<string, unknown>; opts: Record<string, unknown> }> = [];
let settled: Array<Record<string, unknown>> = [];

vi.mock("../server/helpers/apollo-credits/guard.js", () => ({
  reserveEnrichment: async (ctx: Record<string, unknown>, opts: Record<string, unknown>) => {
    reserveCalls.push({ ctx, opts });
    if (!reserveOk) return { ok: false, ...reserveBlocked, state: null };
    const wanted = !!opts.wantPhoneReveal;
    const granted = grantReveal === null ? wanted : grantReveal;
    return {
      ok: true,
      auth: { periodKey: "2026-09-04", legs: [] },
      revealPhone: granted,
      ...(wanted && !granted ? { phoneRevealSkippedReason: "budget_paused" } : {}),
      state: null,
    };
  },
  settleEnrichment: async (_auth: unknown, result: Record<string, unknown>) => {
    settled.push(result);
  },
}));

const { enrichApolloRecord, isEnrichmentFresh } = await import(
  "../server/helpers/enrich-apollo-record.js"
);

let writes: Array<Record<string, unknown>> = [];

const fakeDb = {
  update: () => ({
    set: (values: Record<string, unknown>) => ({
      where: async () => {
        writes.push(values);
      },
    }),
  }),
} as never;

function row(over: Record<string, unknown> = {}) {
  return {
    id: "rec_1",
    name: "Ada Lovelace",
    company: "Analytical Engines",
    enrichmentStatus: "idle",
    enrichedAt: null,
    enrichedEmail: null,
    enrichedTitle: null,
    enrichedPhone: null,
    enrichedLinkedinUrl: null,
    enrichedCompanyIndustry: null,
    enrichedCompanySize: null,
    companyDomain: null,
    enrichmentError: null,
    enrichmentSource: null,
    phoneRevealStatus: null,
    ...over,
  } as never;
}

beforeEach(() => {
  writes = [];
  matchCalls.length = 0;
  reserveOk = true;
  grantReveal = null;
  reserveCalls = [];
  settled = [];
  matchResult = null;
  matchThrows = null;
  orgResult = null;
  orgThrows = null;
  extractedPhone = null;
});

describe("isEnrichmentFresh", () => {
  it("is fresh only for a completed result inside the window", () => {
    const recent = new Date(Date.now() - 1_000).toISOString();
    expect(isEnrichmentFresh({ enrichmentStatus: "done", enrichedAt: recent })).toBe(true);
  });

  it("is never fresh for a non-done status, however recent", () => {
    // idle/failed/not_found have nothing worth keeping, so they always retry.
    const recent = new Date(Date.now() - 1_000).toISOString();
    for (const status of ["idle", "enriching", "failed", "not_found"]) {
      expect(isEnrichmentFresh({ enrichmentStatus: status, enrichedAt: recent })).toBe(false);
    }
  });

  it("is not fresh past the 30-day window", () => {
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    expect(isEnrichmentFresh({ enrichmentStatus: "done", enrichedAt: old })).toBe(false);
  });

  it("is not fresh with no timestamp", () => {
    expect(isEnrichmentFresh({ enrichmentStatus: "done", enrichedAt: null })).toBe(false);
  });
});

describe("enrichApolloRecord — freshness short-circuit", () => {
  it("makes NO Apollo call and NO write for a fresh row", async () => {
    // The regression this guards: the "enriching" claim used to happen in the
    // callers, BEFORE this check, so a fresh row was flipped to "enriching"
    // and then short-circuited with nothing writing a terminal status. The row
    // was stranded there -- showing "Enriching..." forever on prospects (no
    // reaper), and on lead list items the stale-claim reaper reset it and
    // re-enriched it, spending a credit on data we already had.
    const fresh = row({
      enrichmentStatus: "done",
      enrichedAt: new Date().toISOString(),
      enrichedEmail: "ada@example.com",
    });
    const out = await enrichApolloRecord(fakeDb, { kind: "prospect", row: fresh });

    expect(matchCalls).toHaveLength(0);
    expect(writes).toHaveLength(0);
    expect(out.enrichedEmail).toBe("ada@example.com");
    expect(out.enrichmentStatus).toBe("done");
  });

  it("claims the row before calling Apollo when it is NOT fresh", async () => {
    matchResult = { email: "ada@example.com", title: "Countess", id: "apollo_1" };
    await enrichApolloRecord(fakeDb, { kind: "prospect", row: row() });

    // First write is the claim, so the UI can show a spinner and a crashed
    // run is recoverable by the stale-claim reaper.
    expect(writes[0]).toMatchObject({ enrichmentStatus: "enriching" });
    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({ enrichmentStatus: "done" });
  });
});

describe("enrichApolloRecord — phone reveal economics", () => {
  it("does NOT request a reveal by default", async () => {
    // THE credit fix. This used to be `revealPhone = !enrichedPhone`, so every
    // enrich -- including every unattended sweep enrich -- cost 9 credits
    // instead of 1, and re-bought an 8-credit reveal on every non-fresh pass
    // for anyone Apollo had no number for. It is now strictly opt-in.
    matchResult = { id: "apollo_1", email: "a@b.com" };
    await enrichApolloRecord(fakeDb, { kind: "lead_list_item", row: row() });
    expect(matchCalls[0]).toMatchObject({ revealPhone: false });
    expect(reserveCalls[0].opts).toMatchObject({ wantPhoneReveal: false });
  });

  it("requests a reveal only when explicitly asked", async () => {
    matchResult = { id: "apollo_1", email: "a@b.com" };
    await enrichApolloRecord(fakeDb, { kind: "lead_list_item", row: row() }, { revealPhone: true });
    expect(matchCalls[0]).toMatchObject({ revealPhone: true });
  });

  it("proceeds email-only when the guard pauses reveals past the threshold", async () => {
    // Tiered degradation: the 8-credit leg is dropped, the 1-credit one still
    // runs, and the caller is told why rather than the whole enrich failing.
    matchResult = { id: "apollo_1", email: "a@b.com" };
    grantReveal = false;
    const out = await enrichApolloRecord(
      fakeDb,
      { kind: "lead_list_item", row: row() },
      { revealPhone: true },
    );
    expect(matchCalls[0]).toMatchObject({ revealPhone: false });
    expect(out.phoneRevealSkippedReason).toBe("budget_paused");
    expect(out.enrichmentStatus).toBe("done");
  });

  it("keeps an existing number when Apollo's response carries none", async () => {
    // Apollo only echoes contact.phone_numbers on the call that requests a
    // fresh reveal, so a number delivered earlier by webhook is absent from a
    // later plain re-enrich. Without the fallback a routine re-enrich would
    // wipe a real number to null.
    matchResult = { id: "apollo_1", email: "a@b.com" };
    extractedPhone = null;
    const out = await enrichApolloRecord(fakeDb, {
      kind: "prospect",
      row: row({ enrichedPhone: "+1 555 0100" }),
    });
    expect(out.enrichedPhone).toBe("+1 555 0100");
    expect(writes[1]).toMatchObject({ enrichedPhone: "+1 555 0100" });
  });

  it("marks a reveal as requested and stores Apollo's person id to match the webhook", async () => {
    matchResult = { id: "apollo_person_9", email: "a@b.com" };
    extractedPhone = null;
    const out = await enrichApolloRecord(
      fakeDb,
      { kind: "lead_list_item", row: row() },
      { revealPhone: true },
    );
    expect(out.phoneRevealStatus).toBe("requested");
    expect(writes[1]).toMatchObject({
      phoneRevealStatus: "requested",
      phoneRevealRequestId: "apollo_person_9",
    });
  });

  it("marks a reveal done when the number arrived synchronously", async () => {
    matchResult = { id: "apollo_1", email: "a@b.com" };
    extractedPhone = "+1 555 0199";
    const out = await enrichApolloRecord(
      fakeDb,
      { kind: "lead_list_item", row: row() },
      { revealPhone: true },
    );
    expect(out.phoneRevealStatus).toBe("done");
    expect(writes[1]).toMatchObject({ phoneRevealStatus: "done", phoneRevealRequestId: null });
  });

  it("leaves reveal bookkeeping untouched when no reveal was requested", async () => {
    // Overwriting it with this call's irrelevant outcome would clobber a
    // pending webhook's state.
    matchResult = { id: "apollo_1" };
    await enrichApolloRecord(fakeDb, {
      kind: "prospect",
      row: row({ enrichedPhone: "+1 555 0100", phoneRevealStatus: "done" }),
    });
    expect(writes[1]).not.toHaveProperty("phoneRevealStatus");
  });
});

describe("enrichApolloRecord — outcome statuses", () => {
  it("is done when either endpoint returned something", async () => {
    matchResult = null;
    orgResult = { industry: "Computing" };
    const out = await enrichApolloRecord(fakeDb, { kind: "prospect", row: row() });
    expect(out.enrichmentStatus).toBe("done");
    expect(out.enrichedCompanyIndustry).toBe("Computing");
  });

  it("is not_found when both returned nothing and nothing errored", async () => {
    const out = await enrichApolloRecord(fakeDb, { kind: "prospect", row: row() });
    expect(out.enrichmentStatus).toBe("not_found");
    expect(out.enrichmentError).toBeNull();
  });

  it("is failed, with both messages, when both endpoints error", async () => {
    // The two endpoints have independently-scoped key permissions, so one can
    // 403 while the other works -- they're wrapped separately on purpose.
    matchThrows = new Error("Person lookup blew up");
    orgThrows = new Error("Org lookup blew up");
    const out = await enrichApolloRecord(fakeDb, { kind: "prospect", row: row() });
    expect(out.enrichmentStatus).toBe("failed");
    expect(out.enrichmentError).toContain("Person lookup");
    expect(out.enrichmentError).toContain("Organization lookup");
    expect(out.enrichmentError).toContain(" | ");
  });

  it("still keeps org data when only the person lookup fails", async () => {
    matchThrows = new Error("403 person scope");
    orgResult = { industry: "Computing", estimated_num_employees: 40 };
    const out = await enrichApolloRecord(fakeDb, { kind: "prospect", row: row() });
    expect(out.enrichmentStatus).toBe("done");
    expect(out.enrichedCompanySize).toBe(40);
    expect(out.enrichmentError).toContain("Person lookup");
  });

  it("preserves a prior enrichmentSource when this run found nothing", async () => {
    await enrichApolloRecord(fakeDb, {
      kind: "prospect",
      row: row({ enrichmentSource: "apollo_phone_reveal" }),
    });
    expect(writes[1]).toMatchObject({ enrichmentSource: "apollo_phone_reveal" });
  });
});

describe("enrichApolloRecord — a refused spend", () => {
  it("leaves the row completely untouched", async () => {
    // Critical: no claim, no status change, nothing. A budget pause must not
    // corrupt the row or make it look attempted, so it stays retryable once
    // credits are available again.
    reserveOk = false;
    const out = await enrichApolloRecord(fakeDb, { kind: "prospect", row: row() });

    expect(writes).toHaveLength(0);
    expect(matchCalls).toHaveLength(0);
    expect(out.blockedReason).toBe("period_exhausted");
    expect(out.blockedMessage).toBe("Out of credits.");
  });

  it("reports the row's real status rather than inventing a failure", async () => {
    // Nothing was attempted, so nothing failed -- surfacing "failed" here
    // would make a budget pause indistinguishable from bad lead data.
    reserveOk = false;
    const out = await enrichApolloRecord(fakeDb, {
      kind: "prospect",
      row: row({ enrichmentStatus: "idle" }),
    });
    expect(out.enrichmentStatus).toBe("idle");
  });

  it("is checked BEFORE the row is claimed", async () => {
    // Ordering guarantee: reserve must precede the "enriching" write, or a
    // refusal would strand the row exactly like the bug this replaced.
    reserveOk = false;
    await enrichApolloRecord(fakeDb, { kind: "prospect", row: row() });
    expect(reserveCalls).toHaveLength(1);
    expect(writes).toHaveLength(0);
  });
});

describe("enrichApolloRecord — settlement reporting", () => {
  it("reports a match with Apollo's person id, for webhook reconciliation", async () => {
    matchResult = { id: "apollo_person_9", email: "a@b.com" };
    await enrichApolloRecord(fakeDb, { kind: "prospect", row: row() });
    expect(settled[0]).toMatchObject({
      personMatch: { outcome: "match", apolloPersonId: "apollo_person_9" },
    });
  });

  it("reports a no-match distinctly from an error", async () => {
    matchResult = null;
    await enrichApolloRecord(fakeDb, { kind: "prospect", row: row() });
    expect(settled[0]).toMatchObject({ personMatch: { outcome: "no_match" } });
  });

  it("classifies a timeout separately from other failures", async () => {
    // They settle differently on purpose: a timeout stays charged because
    // Apollo may have processed it, while another rejection is treated as
    // not billed.
    matchThrows = new Error("The operation timed out");
    await enrichApolloRecord(fakeDb, { kind: "prospect", row: row() });
    expect(settled[0]).toMatchObject({ personMatch: { outcome: "timeout" } });
  });

  it("classifies a non-timeout rejection as an http error", async () => {
    matchThrows = new Error("Apollo error (403): forbidden");
    await enrichApolloRecord(fakeDb, { kind: "prospect", row: row() });
    expect(settled[0]).toMatchObject({ personMatch: { outcome: "http_error" } });
  });

  it("marks the reveal not_requested when none was asked for", async () => {
    // So its reservation is voided rather than left holding 8 credits.
    matchResult = { id: "apollo_1" };
    await enrichApolloRecord(fakeDb, { kind: "prospect", row: row() });
    expect(settled[0]).toMatchObject({ phoneReveal: { outcome: "not_requested" } });
  });

  it("ties the reveal's fate to the match call it rides on", async () => {
    // The reveal is a flag on the same /people/match request, so a failed
    // match means the reveal never happened either.
    matchThrows = new Error("Apollo error (500)");
    await enrichApolloRecord(fakeDb, { kind: "prospect", row: row() }, { revealPhone: true });
    expect(settled[0]).toMatchObject({ phoneReveal: { outcome: "http_error" } });
  });

  it("settles every leg even when the enrichment itself found nothing", async () => {
    await enrichApolloRecord(fakeDb, { kind: "prospect", row: row() });
    expect(settled).toHaveLength(1);
    expect(settled[0]).toHaveProperty("personMatch");
    expect(settled[0]).toHaveProperty("orgEnrich");
  });
});

describe("enrichApolloRecord — parity across both tables", () => {
  it("writes identical values for a prospect and a lead list item", async () => {
    // The whole point of unifying: the two paths were verbatim copies and had
    // already drifted once. If they ever diverge again this fails.
    matchResult = { id: "apollo_1", email: "ada@example.com", title: "Countess", linkedin_url: "https://x", email_status: "verified", organization: { primary_domain: "example.com" } };
    orgResult = { industry: "Computing", estimated_num_employees: 40 };
    extractedPhone = "+1 555 0199";

    await enrichApolloRecord(fakeDb, { kind: "prospect", row: row() }, { revealPhone: true });
    const prospectWrites = [...writes];
    writes = [];
    matchCalls.length = 0;

    await enrichApolloRecord(fakeDb, { kind: "lead_list_item", row: row() }, { revealPhone: true });

    // Timestamps differ between runs; everything else must match.
    const strip = (v: Record<string, unknown>) => {
      const { enrichedAt, updatedAt, ...rest } = v;
      return rest;
    };
    expect(writes.map(strip)).toEqual(prospectWrites.map(strip));
  });
});
