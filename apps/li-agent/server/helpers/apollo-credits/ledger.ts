import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb } from "../../db/index.js";
import { apolloCreditLedger } from "../../db/schema.js";

// Reads and writes for apollo_credit_ledger. Policy lives in guard.ts; this
// file only knows how to record a spend and how to add one up.

export type ApolloSpendUnit = "person_match" | "phone_reveal" | "org_enrich";
export type ApolloTrigger = "manual" | "sweep" | "agent";
export type LedgerStatus = "reserved" | "committed" | "pending_webhook" | "reconciled" | "voided";

/**
 * What each unit costs, per the account's published pricing.
 *
 * `org_enrich` is 0 because the brief specifies only the 1-credit match and
 * the 8-credit reveal. That is an ASSUMPTION we cannot verify from code, so
 * org-enrich calls are still recorded (at zero) -- if it turns out to bill, the
 * call counts already exist and `reprice` can correct the history rather than
 * us discovering we had no record of it.
 */
export const UNIT_COST: Record<ApolloSpendUnit, number> = {
  person_match: 1,
  phone_reveal: 8,
  org_enrich: 0,
};

/**
 * Statuses that count against the budget.
 *
 * `reserved` counts: a reservation is written BEFORE the Apollo call so that
 * concurrent authorizations can see it. Excluding it would let N simultaneous
 * requests each read the same pre-spend total and all pass.
 *
 * `voided` does not count -- that is the refund path (Apollo rejected the
 * request, or the reveal turned out to be free).
 */
export const COUNTED_STATUSES: readonly LedgerStatus[] = [
  "reserved",
  "committed",
  "pending_webhook",
  "reconciled",
];

/**
 * The single credit expression, used by every sum in the app.
 *
 * `COALESCE(actual, estimated)` is the whole reconciliation design: Apollo's
 * own `credits_consumed` wins once the webhook delivers it, and a webhook
 * reporting 0 refunds the budget with no separate refund code path.
 */
const CREDITS = sql<number>`COALESCE(SUM(COALESCE(${apolloCreditLedger.actualCredits}, ${apolloCreditLedger.estimatedCredits})), 0)`;

export interface SpendBreakdown {
  /** Total credits charged this period. */
  total: number;
  /** Credits by unit. */
  byUnit: Record<ApolloSpendUnit, number>;
  /** Call counts by unit -- distinct from credits, since a reveal is 8:1. */
  countByUnit: Record<ApolloSpendUnit, number>;
  /** Credits by trigger. `sweep` is the automatic pipeline. */
  byTrigger: Record<ApolloTrigger, number>;
  /** Credits spent via an explicit fit-gate override, and how many. */
  overrideCredits: number;
  overrideCount: number;
}

function emptyBreakdown(): SpendBreakdown {
  return {
    total: 0,
    byUnit: { person_match: 0, phone_reveal: 0, org_enrich: 0 },
    countByUnit: { person_match: 0, phone_reveal: 0, org_enrich: 0 },
    byTrigger: { manual: 0, sweep: 0, agent: 0 },
    overrideCredits: 0,
    overrideCount: 0,
  };
}

/**
 * Every number the budget and the gauge need, in ONE grouped scan rather than
 * a query per split. Served by idx_apollo_ledger_period_status.
 */
export async function getPeriodSpend(periodKey: string): Promise<SpendBreakdown> {
  const rows = await getDb()
    .select({
      unit: apolloCreditLedger.unit,
      trigger: apolloCreditLedger.trigger,
      isOverride: apolloCreditLedger.isOverride,
      credits: CREDITS,
      calls: sql<number>`COUNT(*)`,
    })
    .from(apolloCreditLedger)
    .where(
      and(
        eq(apolloCreditLedger.periodStart, periodKey),
        inArray(apolloCreditLedger.status, [...COUNTED_STATUSES]),
      ),
    )
    .groupBy(apolloCreditLedger.unit, apolloCreditLedger.trigger, apolloCreditLedger.isOverride);

  const out = emptyBreakdown();
  for (const r of rows) {
    // SQLite returns SUM/COUNT as numbers; Postgres can return bigint-as-string.
    const credits = Number(r.credits ?? 0);
    const calls = Number(r.calls ?? 0);
    const unit = r.unit as ApolloSpendUnit;
    const trigger = r.trigger as ApolloTrigger;

    out.total += credits;
    if (unit in out.byUnit) {
      out.byUnit[unit] += credits;
      out.countByUnit[unit] += calls;
    }
    if (trigger in out.byTrigger) out.byTrigger[trigger] += credits;
    if (Number(r.isOverride ?? 0) === 1) {
      out.overrideCredits += credits;
      out.overrideCount += calls;
    }
  }
  return out;
}

/**
 * Credits a single user has spent this period.
 *
 * Sweep rows carry `actorEmail = null` and so count against nobody's personal
 * allowance -- automatic spend belongs to the workspace, not to whichever
 * person happened to trigger the request that carried the sweep tick.
 */
export async function getUserPeriodSpend(periodKey: string, actorEmail: string): Promise<number> {
  const [row] = await getDb()
    .select({ credits: CREDITS })
    .from(apolloCreditLedger)
    .where(
      and(
        eq(apolloCreditLedger.periodStart, periodKey),
        eq(apolloCreditLedger.actorEmail, actorEmail),
        inArray(apolloCreditLedger.status, [...COUNTED_STATUSES]),
      ),
    );
  return Number(row?.credits ?? 0);
}

/** Per-user totals for the admin allocation table. */
export async function getSpendByUser(
  periodKey: string,
): Promise<Array<{ actorEmail: string; credits: number; calls: number }>> {
  const rows = await getDb()
    .select({
      actorEmail: apolloCreditLedger.actorEmail,
      credits: CREDITS,
      calls: sql<number>`COUNT(*)`,
    })
    .from(apolloCreditLedger)
    .where(
      and(
        eq(apolloCreditLedger.periodStart, periodKey),
        inArray(apolloCreditLedger.status, [...COUNTED_STATUSES]),
      ),
    )
    .groupBy(apolloCreditLedger.actorEmail);

  return rows
    .filter((r): r is typeof r & { actorEmail: string } => !!r.actorEmail)
    .map((r) => ({
      actorEmail: r.actorEmail,
      credits: Number(r.credits ?? 0),
      calls: Number(r.calls ?? 0),
    }))
    .sort((a, b) => b.credits - a.credits);
}

/** Mirrors the fitVerdict enum on prospects/leadListItems. */
export type FitVerdict = "strong" | "possible" | "weak" | "inconclusive";

const FIT_VERDICTS: readonly string[] = ["strong", "possible", "weak", "inconclusive"];

/**
 * Narrows a verdict read off a DB row (typed loosely at some call sites) to the
 * ledger column's enum, so an unexpected value is stored as null rather than
 * cast past the type system.
 */
export function asFitVerdict(value: string | null | undefined): FitVerdict | null {
  return value && FIT_VERDICTS.includes(value) ? (value as FitVerdict) : null;
}

export interface RecordSpendInput {
  unit: ApolloSpendUnit;
  periodKey: string;
  trigger: ApolloTrigger;
  actorEmail: string | null;
  subjectTable: "lead_list_items" | "prospects" | null;
  subjectId: string | null;
  fitVerdict: FitVerdict | null;
  isOverride?: boolean;
}

/** Writes a `reserved` row and returns its id. Called before the Apollo call. */
export async function insertReservation(input: RecordSpendInput): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await getDb().insert(apolloCreditLedger).values({
    id,
    unit: input.unit,
    estimatedCredits: UNIT_COST[input.unit],
    actualCredits: null,
    status: "reserved",
    periodStart: input.periodKey,
    subjectTable: input.subjectTable,
    subjectId: input.subjectId,
    actorEmail: input.actorEmail,
    trigger: input.trigger,
    fitVerdict: input.fitVerdict,
    isOverride: input.isOverride ? 1 : 0,
    apolloPersonId: null,
    outcome: null,
    note: null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/** Moves a reservation to a terminal (or webhook-pending) state. */
export async function finalizeLedgerRow(
  ledgerId: string,
  patch: {
    status: LedgerStatus;
    outcome?: string | null;
    apolloPersonId?: string | null;
    note?: string | null;
    actualCredits?: number | null;
  },
): Promise<void> {
  await getDb()
    .update(apolloCreditLedger)
    .set({
      status: patch.status,
      ...(patch.outcome !== undefined ? { outcome: patch.outcome } : {}),
      ...(patch.apolloPersonId !== undefined ? { apolloPersonId: patch.apolloPersonId } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.actualCredits !== undefined ? { actualCredits: patch.actualCredits } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(apolloCreditLedger.id, ledgerId));
}

/**
 * Releases reservations abandoned by a process that died between reserving and
 * settling. Without this they consume budget forever.
 *
 * Called from the sweep tick rather than a cron, because this app has no
 * reliable scheduler (see server/middleware/lead-pipeline-sweep.ts).
 */
export async function voidStaleReservations(olderThanMs = 5 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const stale = await getDb()
    .select({ id: apolloCreditLedger.id })
    .from(apolloCreditLedger)
    .where(and(eq(apolloCreditLedger.status, "reserved"), lt(apolloCreditLedger.createdAt, cutoff)));
  if (stale.length === 0) return 0;

  for (const row of stale) {
    await finalizeLedgerRow(row.id, {
      status: "voided",
      outcome: "orphaned",
      note: "Reservation abandoned; no settle recorded within the stale window.",
    });
  }
  return stale.length;
}

/**
 * Finds the open reveal reservation for an Apollo person id, newest first.
 *
 * Matched against THIS table rather than against the lead row on purpose:
 * score-lead-list-item.ts copies `phoneRevealRequestId` onto the promoted
 * prospects row, so one Apollo person id legitimately exists on two records
 * and a record-based match could reconcile the wrong one.
 */
export async function findOpenRevealByPersonId(apolloPersonId: string) {
  const [row] = await getDb()
    .select({
      id: apolloCreditLedger.id,
      estimatedCredits: apolloCreditLedger.estimatedCredits,
      subjectTable: apolloCreditLedger.subjectTable,
      subjectId: apolloCreditLedger.subjectId,
    })
    .from(apolloCreditLedger)
    .where(
      and(
        eq(apolloCreditLedger.unit, "phone_reveal"),
        eq(apolloCreditLedger.apolloPersonId, apolloPersonId),
        eq(apolloCreditLedger.status, "pending_webhook"),
      ),
    )
    .orderBy(sql`${apolloCreditLedger.createdAt} DESC`)
    .limit(1);
  return row ?? null;
}
