# Team Activity Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-teammate activity breakdown (prospects added, drafted, sent, send rate, fit-verdict counts) to the existing admin-only `/analytics` page.

**Architecture:** Extend the existing `get-analytics` action with one additional grouped SQL query (grouped by `prospects.ownerEmail`), returned as a new `byUser` array on the same response. Render it as a new "Team Activity" table section on the existing `analytics.tsx` route, reusing the page's existing Card/pct()/color conventions. No new action, no new route, no schema changes.

**Tech Stack:** `@agent-native/core` actions (`defineAction`), Drizzle ORM over SQLite (`server/db/schema.ts` `prospects` table), React Router route (`app/routes/analytics.tsx`), shadcn/ui `Card`, `@tabler/icons-react`, Vitest (`node` environment, source-content assertions — this repo's established test style, see `test/feedback.test.ts`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-21-team-activity-analytics-design.md`
- Admin-only: all new data must ride through the existing `requireAdmin(ctx)` gate in `get-analytics.ts` — do not add a new auth path.
- No schema changes, no new action, no new route — extend `get-analytics.ts` and `analytics.tsx` only.
- "Drafted" count means rows *currently* at `status = 'drafted'` (not yet sent) — not a cumulative "ever drafted" count. A row leaves the drafted bucket once it reaches `status = 'sent'`.
- SQL must be portable (plain ANSI `CASE WHEN ... THEN 1 ELSE 0 END`, no SQLite- or Postgres-specific syntax) per this repo's portability convention.
- Follow this repo's existing test convention exactly: source-content assertions (`readFile(...)` + `expect(src).toContain(...)`), not DB-seeding integration tests — see `test/feedback.test.ts` for the pattern to match.

---

### Task 1: Add `byUser` grouped query to `get-analytics` action

**Files:**
- Modify: `apps/outreach/actions/get-analytics.ts`
- Test: Create `apps/outreach/test/analytics-team-activity.test.ts`

**Interfaces:**
- Consumes: `prospects` table (`ownerEmail`, `status`, `fitVerdict` columns) from `apps/outreach/server/db/schema.ts` (already exists, unchanged).
- Produces: `get-analytics` action response gains a new field:
  ```ts
  byUser: Array<{
    ownerEmail: string | null;
    total: number;
    drafted: number;
    sent: number;
    strong: number;
    possible: number;
    weak: number;
    inconclusive: number;
  }>
  ```
  Sorted by `total` descending. Task 2 (the UI) consumes this exact shape.

- [ ] **Step 1: Write the failing test**

Create `apps/outreach/test/analytics-team-activity.test.ts`:

```ts
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const OUTREACH = "http://127.0.0.1:8101/outreach";

function readFile(rel: string): string {
  return fs.readFileSync(path.resolve(ROOT, rel), "utf8");
}

function serverRunning(): boolean {
  try {
    const { execSync } = require("child_process");
    execSync(`curl -s --max-time 2 "${OUTREACH}/_agent-native/actions/get-draft?profileUrl=x" -o /dev/null`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

describe("get-analytics action — byUser breakdown", () => {
  it("groups prospects by ownerEmail", () => {
    const src = readFile("actions/get-analytics.ts");
    expect(src).toContain("groupBy(prospects.ownerEmail)");
  });

  it("counts drafted and sent per user via the prospects.status enum", () => {
    const src = readFile("actions/get-analytics.ts");
    expect(src).toContain("'drafted'");
    expect(src).toContain("'sent'");
  });

  it("counts fit verdicts per user", () => {
    const src = readFile("actions/get-analytics.ts");
    expect(src).toContain("'strong'");
    expect(src).toContain("'possible'");
    expect(src).toContain("'weak'");
    expect(src).toContain("'inconclusive'");
  });

  it("returns a byUser field", () => {
    const src = readFile("actions/get-analytics.ts");
    expect(src).toContain("byUser");
  });

  it("still requires admin (requireAdmin unchanged)", () => {
    const src = readFile("actions/get-analytics.ts");
    expect(src).toContain("requireAdmin(ctx)");
  });

  it("live: get-analytics rejects unauthenticated callers", async () => {
    if (!serverRunning()) {
      console.warn("Server not running — skipping");
      return;
    }
    const res = await fetch(`${OUTREACH}/_agent-native/actions/get-analytics`).catch(() => null);
    if (!res) return;
    expect([401, 403]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/outreach && pnpm test analytics-team-activity`
Expected: FAIL — `get-analytics.ts` doesn't yet contain `groupBy(prospects.ownerEmail)`, `byUser`, etc. The last ("live") test will skip with a console warning if no dev server is running on :8101 — that's fine, it isn't the one this task's implementation targets.

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `apps/outreach/actions/get-analytics.ts` with:

```ts
import { defineAction } from "@agent-native/core";
import { count, countDistinct, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { prospects, sendHistory } from "../server/db/schema.js";
import { requireAdmin } from "../server/helpers/require-admin.js";

export default defineAction({
  description: "Return workspace-wide pipeline analytics. Admin only.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    await requireAdmin(ctx);
    const db = getDb();

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const [
      [totals],
      verdictRows,
      statusRows,
      [usersRow],
      [thisWeekRow],
      [lastWeekRow],
      [sentRow],
      byUserRows,
    ] = await Promise.all([
      db.select({ total: count() }).from(prospects),
      db.select({ verdict: prospects.fitVerdict, n: count() }).from(prospects).groupBy(prospects.fitVerdict),
      db.select({ status: prospects.status, n: count() }).from(prospects).groupBy(prospects.status),
      db.select({ n: countDistinct(prospects.ownerEmail) }).from(prospects),
      db.select({ n: count() }).from(prospects).where(sql`created_at >= ${weekAgo}`),
      db.select({ n: count() }).from(prospects).where(sql`created_at >= ${twoWeeksAgo} AND created_at < ${weekAgo}`),
      db.select({ n: count() }).from(sendHistory),
      db
        .select({
          ownerEmail: prospects.ownerEmail,
          total: count(),
          drafted: sql<number>`sum(case when ${prospects.status} = 'drafted' then 1 else 0 end)`,
          sent: sql<number>`sum(case when ${prospects.status} = 'sent' then 1 else 0 end)`,
          strong: sql<number>`sum(case when ${prospects.fitVerdict} = 'strong' then 1 else 0 end)`,
          possible: sql<number>`sum(case when ${prospects.fitVerdict} = 'possible' then 1 else 0 end)`,
          weak: sql<number>`sum(case when ${prospects.fitVerdict} = 'weak' then 1 else 0 end)`,
          inconclusive: sql<number>`sum(case when ${prospects.fitVerdict} = 'inconclusive' then 1 else 0 end)`,
        })
        .from(prospects)
        .groupBy(prospects.ownerEmail),
    ]);

    const verdictCounts = { strong: 0, possible: 0, weak: 0 };
    for (const r of verdictRows) {
      if (r.verdict === "strong" || r.verdict === "possible" || r.verdict === "weak") {
        verdictCounts[r.verdict] = r.n as number;
      }
    }

    const statusCounts = { captured: 0, drafted: 0, sent: 0 };
    for (const r of statusRows) {
      if (r.status === "captured" || r.status === "drafted" || r.status === "sent") {
        statusCounts[r.status] = r.n as number;
      }
    }

    const byUser = byUserRows
      .map((r) => ({
        ownerEmail: r.ownerEmail,
        total: Number(r.total),
        drafted: Number(r.drafted),
        sent: Number(r.sent),
        strong: Number(r.strong),
        possible: Number(r.possible),
        weak: Number(r.weak),
        inconclusive: Number(r.inconclusive),
      }))
      .sort((a, b) => b.total - a.total);

    return {
      totalProspects: (totals?.total ?? 0) as number,
      verdictCounts,
      statusCounts,
      thisWeek: (thisWeekRow?.n ?? 0) as number,
      lastWeek: (lastWeekRow?.n ?? 0) as number,
      totalUsers: (usersRow?.n ?? 0) as number,
      totalSent: (sentRow?.n ?? 0) as number,
      byUser,
    };
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/outreach && pnpm test analytics-team-activity`
Expected: PASS (the "live" test still skips with a warning if no dev server is running — that's expected and fine)

- [ ] **Step 5: Typecheck**

Run: `cd apps/outreach && pnpm typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/outreach/actions/get-analytics.ts apps/outreach/test/analytics-team-activity.test.ts
git commit -m "Add per-user activity breakdown to get-analytics action"
```

---

### Task 2: Add "Team Activity" table section to `analytics.tsx`

**Files:**
- Modify: `apps/outreach/app/routes/analytics.tsx`
- Test: Modify `apps/outreach/test/analytics-team-activity.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: `byUser` field from Task 1's `get-analytics` response — exact shape:
  ```ts
  { ownerEmail: string | null; total: number; drafted: number; sent: number; strong: number; possible: number; weak: number; inconclusive: number }[]
  ```
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Write the failing test**

Append to `apps/outreach/test/analytics-team-activity.test.ts` (after the existing `describe` block, same file):

```ts
describe("analytics.tsx — Team Activity section", () => {
  it("reads byUser from the get-analytics response", () => {
    const src = readFile("app/routes/analytics.tsx");
    expect(src).toContain("byUser");
  });

  it("renders a Team Activity heading", () => {
    const src = readFile("app/routes/analytics.tsx");
    expect(src).toContain("Team Activity");
  });

  it("shows Added, Drafted, Sent, and Send Rate columns", () => {
    const src = readFile("app/routes/analytics.tsx");
    expect(src).toContain("Added");
    expect(src).toContain("Drafted");
    expect(src).toContain("Sent");
    expect(src).toContain("Send Rate");
  });

  it("falls back to \"Unassigned\" for null ownerEmail", () => {
    const src = readFile("app/routes/analytics.tsx");
    expect(src).toContain("Unassigned");
  });

  it("has an empty state for zero team members", () => {
    const src = readFile("app/routes/analytics.tsx");
    expect(src).toContain("No prospects added yet");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/outreach && pnpm test analytics-team-activity`
Expected: FAIL on the new "Team Activity section" tests — `analytics.tsx` doesn't contain any of this yet. The Task 1 tests from the previous section should still PASS.

- [ ] **Step 3: Write minimal implementation**

In `apps/outreach/app/routes/analytics.tsx`:

**3a.** Add `IconUsers` to the existing tabler icons import (line 3):

```ts
import { IconChartBar, IconLoader2, IconMessageReport, IconThumbDown, IconThumbUp, IconUsers } from "@tabler/icons-react";
```

**3b.** Extend the `d` type cast (currently lines 58–66) to add `byUser`:

```ts
  const d = data as {
    totalProspects: number;
    verdictCounts: { strong: number; possible: number; weak: number };
    statusCounts: { captured: number; drafted: number; sent: number };
    thisWeek: number;
    lastWeek: number;
    totalUsers: number;
    totalSent: number;
    byUser: {
      ownerEmail: string | null;
      total: number;
      drafted: number;
      sent: number;
      strong: number;
      possible: number;
      weak: number;
      inconclusive: number;
    }[];
  };
```

**3c.** Insert a new section between the closing `</Card>` of "Status funnel" and the `{/* User Feedback */}` comment (currently around line 129–131):

```tsx
      {/* Team Activity */}
      <TeamActivitySection byUser={d.byUser} />

      {/* User Feedback */}
```

**3d.** Add the `TeamActivitySection` component and its `UserActivity` type near the other section components (e.g. right after the `FeedbackSection` function, before `StatCard`):

```tsx
type UserActivity = {
  ownerEmail: string | null;
  total: number;
  drafted: number;
  sent: number;
  strong: number;
  possible: number;
  weak: number;
  inconclusive: number;
};

function TeamActivitySection({ byUser }: { byUser: UserActivity[] }) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-medium text-muted-foreground">Team Activity</h2>
      {byUser.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-10 text-center">
          <IconUsers className="size-7 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No prospects added yet.</p>
        </div>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Teammate</th>
                  <th className="px-4 py-2 text-right font-medium">Added</th>
                  <th className="px-4 py-2 text-right font-medium">Drafted</th>
                  <th className="px-4 py-2 text-right font-medium">Sent</th>
                  <th className="px-4 py-2 text-right font-medium">Send Rate</th>
                  <th className="px-4 py-2 text-right font-medium">Strong / Possible / Weak</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {byUser.map((u) => (
                  <tr key={u.ownerEmail ?? "unassigned"}>
                    <td className="px-4 py-2.5 font-medium">{u.ownerEmail ?? "Unassigned"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{u.total.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{u.drafted.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{u.sent.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{pct(u.sent, u.total)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <span className="text-emerald-600 dark:text-emerald-400">{u.strong}</span>
                      {" / "}
                      <span className="text-amber-600 dark:text-amber-400">{u.possible}</span>
                      {" / "}
                      <span className="text-rose-600 dark:text-rose-400">{u.weak}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/outreach && pnpm test analytics-team-activity`
Expected: PASS — all tests from both `describe` blocks in this file.

- [ ] **Step 5: Typecheck**

Run: `cd apps/outreach && pnpm typecheck`
Expected: no errors

- [ ] **Step 6: Run the full test suite**

Run: `cd apps/outreach && pnpm test`
Expected: same pass/fail counts as the pre-existing baseline (this repo has 2 known-unrelated pre-existing failures — a live-server-dependent test and an unrelated `submit-feedback.ts` assertion — do not let those block this task; just confirm no *new* failures were introduced).

- [ ] **Step 7: Manual verification in the browser**

Run: `cd apps/outreach && pnpm dev`
Then: sign in as the workspace admin (or `WORKSPACE_OWNER_EMAIL`), navigate to `/analytics`, and confirm:
- A "Team Activity" table renders below "Status Funnel."
- If no prospects exist yet, the empty state ("No prospects added yet.") shows instead.
- If prospects exist, each distinct `ownerEmail` appears as its own row with correct counts.

- [ ] **Step 8: Commit**

```bash
git add apps/outreach/app/routes/analytics.tsx apps/outreach/test/analytics-team-activity.test.ts
git commit -m "Add Team Activity table to analytics page"
git push origin main
```

---

## Plan Self-Review Notes

- **Spec coverage:** Per-user total/drafted/sent/send-rate/verdict breakdown (Task 1 query + Task 2 UI) ✓. Admin-only gating preserved via existing `requireAdmin` (Task 1, unchanged) ✓. "Unassigned" for null `ownerEmail` (Task 2) ✓. Summary-table-only scope, no drill-down (Task 2 has no click-through) ✓. Test plan matches spec's testing section, adapted to this repo's actual (source-content) test convention rather than DB-seeding, since that's the established pattern here ✓.
- **Placeholder scan:** No TBD/TODO; every step has complete, runnable code.
- **Type consistency:** `byUser` shape is identical across Task 1's produced type and Task 2's consumed type (`ownerEmail`, `total`, `drafted`, `sent`, `strong`, `possible`, `weak`, `inconclusive` — same names, same order, both tasks).
