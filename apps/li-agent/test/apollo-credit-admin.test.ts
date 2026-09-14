import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// The admin write paths. Each one is gated by requireAdmin and writes either
// workspace_settings or apollo_user_credit_limits, so these tests fake the DB
// layer and assert the DECISIONS -- what gets written, what gets deleted, what
// is refused -- rather than the SQL.

// ── setUserCreditLimit ──────────────────────────────────────────────────

const dbCalls: Array<{ op: string; values?: unknown; where?: unknown }> = [];

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    insert: () => ({
      values: (values: unknown) => ({
        onConflictDoUpdate: (arg: unknown) => {
          dbCalls.push({ op: "upsert", values, where: arg });
          return Promise.resolve();
        },
        onConflictDoNothing: () => {
          dbCalls.push({ op: "insert", values });
          return Promise.resolve();
        },
      }),
    }),
    delete: () => ({
      where: (where: unknown) => {
        dbCalls.push({ op: "delete", where });
        return Promise.resolve();
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([]) }),
        orderBy: () => Promise.resolve([]),
      }),
    }),
  }),
}));

const { setUserCreditLimit } = await import("../server/helpers/apollo-credits/user-limits.js");

describe("setUserCreditLimit", () => {
  it("DELETES the row for a null limit rather than writing the current default", async () => {
    // This is the load-bearing decision. Pinning the user to today's default
    // would mean a later change to the workspace default silently skipped
    // everyone who had ever appeared in the table -- the admin would raise the
    // default and wonder why nothing happened for half the team.
    dbCalls.length = 0;
    await setUserCreditLimit("Someone@Builder.io", null);
    expect(dbCalls.map((c) => c.op)).toContain("delete");
    expect(dbCalls.map((c) => c.op)).not.toContain("upsert");
  });

  it("upserts a real limit", async () => {
    dbCalls.length = 0;
    await setUserCreditLimit("someone@builder.io", 500);
    expect(dbCalls.map((c) => c.op)).toContain("upsert");
  });

  it("lowercases the email on the way in", async () => {
    dbCalls.length = 0;
    await setUserCreditLimit("MiXeD@Builder.IO", 100);
    const values = dbCalls.find((c) => c.op === "upsert")?.values as { userEmail?: string } | undefined;
    // Otherwise "Fred@" and "fred@" become two rows and the one the guard
    // reads is whichever case the session happened to carry.
    expect(values?.userEmail).toBe("mixed@builder.io");
  });
});

// ── Action-shape guarantees ─────────────────────────────────────────────
//
// Source-level assertions, because these properties are the reason the actions
// are safe and a future edit that drops one would not fail any other test.

function src(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("set-apollo-credit-settings", () => {
  const SRC = src("actions/set-apollo-credit-settings.ts");

  it("requires admin before touching anything", () => {
    expect(SRC).toContain("requireAdmin");
    const guardAt = SRC.indexOf("await requireAdmin(ctx)");
    const dbAt = SRC.indexOf("getDb()");
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(dbAt);
  });

  it("refuses a phone-stop of 0", () => {
    // A 0% phone stop would block every reveal forever while looking like a
    // configuration value rather than an outage. The floor is 1.
    expect(SRC).toMatch(/phoneStopPct:.*min\(1\)/);
  });

  it("makes every field optional so one control cannot clobber the others", () => {
    // The card saves individual knobs; a required field would mean saving the
    // budget silently reset the fit bars to whatever the form last held.
    for (const field of [
      "enabled",
      "periodBudget",
      "anchorDay",
      "userDefaultLimit",
      "phoneStopPct",
      "sweepReservePct",
      "enrichMinVerdict",
      "phoneMinVerdict",
    ]) {
      const line = SRC.split("\n").find((l) => l.trim().startsWith(`${field}:`));
      expect(line, `${field} should be declared`).toBeTruthy();
      expect(line, `${field} should be nullish`).toContain("nullish()");
    }
  });

  it("audits turning the switch OFF distinctly", () => {
    // "Apollo credit settings updated" is useless when the question is who
    // stopped enrichment and when.
    expect(SRC).toContain("Apollo enrichment TURNED OFF");
  });
});

describe("get-apollo-user-limits", () => {
  const SRC = src("actions/get-apollo-user-limits.ts");

  it("is admin-only", () => {
    expect(SRC).toContain("await requireAdmin(ctx)");
  });

  it("includes anyone who has SPENT, not just anyone with a role row", () => {
    // Otherwise a spender with no role row is invisible in this table while
    // still counting against the workspace total, which is the sort of
    // discrepancy that makes an admin distrust the whole page.
    expect(SRC).toContain("for (const r of spendRows) emails.add");
  });

  it("distinguishes an inherited limit from an explicit one", () => {
    expect(SRC).toContain("explicitLimit");
    expect(SRC).toContain("effectiveLimit");
  });

  it("reports over-allocation rather than preventing it", () => {
    // Per-user limits are independent ceilings, not an allocation that has to
    // balance -- but summing past the budget should be a visible choice.
    expect(SRC).toContain("overAllocated");
    expect(SRC).not.toContain("throw");
  });
});

describe("reprice-apollo-credit-ledger", () => {
  const SRC = src("actions/reprice-apollo-credit-ledger.ts");

  it("defaults to a dry run", () => {
    expect(SRC).toMatch(/dryRun: z\.boolean\(\)\.default\(true\)/);
  });

  it("refuses to apply without a confirmed row count", () => {
    expect(SRC).toContain("Run with dryRun first");
    expect(SRC).toContain("Row count changed since the preview");
  });

  it("never reprices voided rows", () => {
    // A voided reservation was never charged; giving it a cost would resurrect
    // spend that did not happen.
    expect(SRC).toContain('inArray(apolloCreditLedger.status, ["reserved", "committed", "pending_webhook", "reconciled"])');
    expect(SRC).not.toContain('"voided"');
  });

  it("writes actualCredits, which the budget sums already prefer", () => {
    // No recount and no separate refund path: COALESCE(actual, estimated) is
    // already what every spend check reads.
    expect(SRC).toContain("actualCredits: input.actualCredits");
  });
});

describe("list-apollo-credit-ledger", () => {
  const SRC = src("actions/list-apollo-credit-ledger.ts");

  it("excludes voided rows by default but keeps them fetchable", () => {
    // They cost nothing, so counting them would inflate a reconciliation --
    // but a pile of them signals processes dying between reserve and settle.
    expect(SRC).toMatch(/includeVoided: z\.boolean\(\)\.default\(false\)/);
  });

  it("reports how much of the total is still an ESTIMATE", () => {
    // Apollo only confirms cost for the reveal leg, so a match-heavy period is
    // almost entirely guessed. Presenting one total would overstate certainty.
    expect(SRC).toContain("estimatedCredits");
    expect(SRC).toContain("reconciledCredits");
  });

  it("flags a truncated export instead of silently capping it", () => {
    expect(SRC).toContain("truncated");
  });
});
