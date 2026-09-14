import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb } from "../../db/index.js";
import { apolloCreditLedger, apolloWebhookDeliveries } from "../../db/schema.js";

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

/**
 * Outcomes where we were charged and got nothing usable back.
 *
 * Under the "charged only for data delivered" rule most empty outcomes settle
 * at zero credits, so this list is deliberately short: it is the outcomes that
 * stay CHARGED despite delivering nothing, which is exactly what "wasted"
 * should mean. A `no_match` costs nothing, so calling it waste would be
 * misleading; a timed-out reveal cost 8 and produced no number, so it is.
 */
export const WASTED_OUTCOMES: readonly string[] = [
  "reveal_timeout",
  "match_timeout",
  "timeout",
];

/** 1 when this row was charged but delivered nothing, else 0. */
const WASTED_CREDITS = sql<number>`COALESCE(SUM(CASE WHEN ${apolloCreditLedger.outcome} IN ('reveal_timeout','match_timeout','timeout') THEN COALESCE(${apolloCreditLedger.actualCredits}, ${apolloCreditLedger.estimatedCredits}) ELSE 0 END), 0)`;

/**
 * Credits spent on a lead the ICP had scored WEAK, or spent by explicitly
 * overriding the fit gate.
 *
 * This is the other, larger sense of "wasted" -- the money did buy real data,
 * it just bought it for somebody not worth calling. Kept separate from
 * WASTED_CREDITS because the two have different fixes: one is a reliability
 * problem, the other is a discipline problem.
 */
const LOW_FIT_CREDITS = sql<number>`COALESCE(SUM(CASE WHEN ${apolloCreditLedger.isOverride} = 1 OR ${apolloCreditLedger.fitVerdict} = 'weak' THEN COALESCE(${apolloCreditLedger.actualCredits}, ${apolloCreditLedger.estimatedCredits}) ELSE 0 END), 0)`;

/** Credits that actually bought a usable email or phone number. */
const DELIVERED_CREDITS = sql<number>`COALESCE(SUM(CASE WHEN ${apolloCreditLedger.outcome} IN ('match_email','revealed_sync','revealed') THEN COALESCE(${apolloCreditLedger.actualCredits}, ${apolloCreditLedger.estimatedCredits}) ELSE 0 END), 0)`;

/** Credits by unit, for the per-person composition bars. */
const EMAIL_CREDITS = sql<number>`COALESCE(SUM(CASE WHEN ${apolloCreditLedger.unit} = 'person_match' THEN COALESCE(${apolloCreditLedger.actualCredits}, ${apolloCreditLedger.estimatedCredits}) ELSE 0 END), 0)`;
const PHONE_CREDITS = sql<number>`COALESCE(SUM(CASE WHEN ${apolloCreditLedger.unit} = 'phone_reveal' THEN COALESCE(${apolloCreditLedger.actualCredits}, ${apolloCreditLedger.estimatedCredits}) ELSE 0 END), 0)`;

/** Calls that returned nothing usable, charged or not. */
const EMPTY_CALLS = sql<number>`COALESCE(SUM(CASE WHEN ${apolloCreditLedger.outcome} IN ('no_match','match_no_email','reveal_no_number','reveal_no_match','reveal_timeout') THEN 1 ELSE 0 END), 0)`;

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
  /**
   * Credits charged where nothing usable came back.
   *
   * Under "charged only for data delivered" this should stay near zero, and
   * that is precisely why it is worth surfacing: a number climbing here means
   * reveals are timing out, not that Apollo is short of data.
   */
  wastedCredits: number;
  /** Credits spent on weak-fit leads or via a fit-gate override. */
  lowFitCredits: number;
  /** Lookups that returned nothing. Free, but people assume otherwise. */
  emptyCalls: number;
}

function emptyBreakdown(): SpendBreakdown {
  return {
    total: 0,
    byUnit: { person_match: 0, phone_reveal: 0, org_enrich: 0 },
    countByUnit: { person_match: 0, phone_reveal: 0, org_enrich: 0 },
    byTrigger: { manual: 0, sweep: 0, agent: 0 },
    overrideCredits: 0,
    overrideCount: 0,
    wastedCredits: 0,
    lowFitCredits: 0,
    emptyCalls: 0,
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
      wasted: WASTED_CREDITS,
      lowFit: LOW_FIT_CREDITS,
      empty: EMPTY_CALLS,
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
    out.wastedCredits += Number(r.wasted ?? 0);
    out.lowFitCredits += Number(r.lowFit ?? 0);
    out.emptyCalls += Number(r.empty ?? 0);
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

export interface UserSpend {
  actorEmail: string;
  /** Total credits charged. */
  credits: number;
  /** Apollo calls made, charged or not. */
  calls: number;
  /** Credits that bought a real email or phone number. */
  delivered: number;
  /** Credits charged that returned nothing usable. */
  wasted: number;
  /** Credits spent on weak-fit leads or via a fit-gate override. */
  lowFit: number;
  /** Calls that returned nothing -- mostly free, but worth seeing. */
  emptyCalls: number;
  /**
   * Credits by unit.
   *
   * What makes a stacked per-person bar readable rather than just a total: at
   * 8:1, two people with the same spend can have spent it on 8 emails or on
   * one phone reveal, and those are different behaviours.
   */
  emailCredits: number;
  phoneCredits: number;
}

export async function getSpendByUser(periodKey: string): Promise<UserSpend[]> {
  const rows = await getDb()
    .select({
      actorEmail: apolloCreditLedger.actorEmail,
      credits: CREDITS,
      calls: sql<number>`COUNT(*)`,
      delivered: DELIVERED_CREDITS,
      wasted: WASTED_CREDITS,
      lowFit: LOW_FIT_CREDITS,
      emptyCalls: EMPTY_CALLS,
      emailCredits: EMAIL_CREDITS,
      phoneCredits: PHONE_CREDITS,
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
      delivered: Number(r.delivered ?? 0),
      wasted: Number(r.wasted ?? 0),
      lowFit: Number(r.lowFit ?? 0),
      emptyCalls: Number(r.emptyCalls ?? 0),
      emailCredits: Number(r.emailCredits ?? 0),
      phoneCredits: Number(r.phoneCredits ?? 0),
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
 * Records that a webhook payload was seen, returning false if it already had
 * been.
 *
 * Apollo delivers at-least-once, so the handler must be idempotent. The
 * existing phone-number write happens to be idempotent by accident (same value
 * written twice); credit reconciliation would NOT be -- a redelivery would
 * reconcile a second time. Keyed on a hash of the raw body so a genuine retry
 * of the same payload is recognised regardless of ordering or timing.
 */
export async function claimWebhookDelivery(
  deliveryId: string,
  creditsConsumed: number | null,
  apolloPersonIds: string[],
): Promise<boolean> {
  const existing = await getDb()
    .select({ id: apolloWebhookDeliveries.id })
    .from(apolloWebhookDeliveries)
    .where(eq(apolloWebhookDeliveries.id, deliveryId))
    .limit(1);
  if (existing.length > 0) return false;

  await getDb()
    .insert(apolloWebhookDeliveries)
    .values({
      id: deliveryId,
      receivedAt: new Date().toISOString(),
      creditsConsumed,
      apolloPersonIds: apolloPersonIds.join(","),
    })
    .onConflictDoNothing();

  // Re-read rather than trusting the insert: two concurrent deliveries of the
  // same payload both pass the check above, and onConflictDoNothing's affected
  // row count is not portable across SQLite and Postgres.
  const after = await getDb()
    .select({ receivedAt: apolloWebhookDeliveries.receivedAt })
    .from(apolloWebhookDeliveries)
    .where(eq(apolloWebhookDeliveries.id, deliveryId))
    .limit(1);
  return after.length > 0;
}

/**
 * The maximum credits a single reveal can be reconciled to.
 *
 * The webhook endpoint is `requiresAuth: false` and publicly reachable, so
 * `credits_consumed` arrives from an UNTRUSTED source. Without a ceiling a
 * forged payload could inflate recorded spend and hard-stop enrichment for the
 * whole workspace -- a self-inflicted denial of service. Clamped to what we
 * actually reserved.
 */
export const MAX_RECONCILED_REVEAL_CREDITS = UNIT_COST.phone_reveal;

/**
 * Applies Apollo's authoritative cost to the reservation a reveal created.
 *
 * Returns what happened, so the caller can log a payload that matched nothing.
 */
export async function reconcileRevealCredits(
  apolloPersonId: string,
  creditsConsumed: number | null,
  outcome: "revealed" | "reveal_no_match",
): Promise<"reconciled" | "no_open_reservation"> {
  const open = await findOpenRevealByPersonId(apolloPersonId);
  // Nothing open to reconcile: either already settled by an earlier delivery,
  // or a payload for a reveal this app never requested. Either way, do not
  // create anything -- an unauthenticated endpoint must not be able to write
  // new spend rows.
  if (!open) return "no_open_reservation";

  let actual: number | null = null;
  if (creditsConsumed != null && Number.isFinite(creditsConsumed)) {
    actual = Math.min(MAX_RECONCILED_REVEAL_CREDITS, Math.max(0, Math.trunc(creditsConsumed)));
  } else if (outcome === "reveal_no_match") {
    // Apollo delivered no number, and Apollo bills for data delivered. Falling
    // back to the reserved 8 here would leave the budget permanently short by
    // 8 for every person it has no number for -- which, across a list, is the
    // difference between the gauge being trustworthy and not.
    actual = 0;
  }

  await finalizeLedgerRow(open.id, {
    status: "reconciled",
    outcome,
    // Null leaves COALESCE(actual, estimated) falling back to the 8 we
    // reserved, which is the conservative direction when Apollo delivered a
    // number but did not say what it charged.
    actualCredits: actual,
    note:
      creditsConsumed != null
        ? `apollo credits_consumed=${creditsConsumed}`
        : outcome === "reveal_no_match"
          ? "no number delivered; charged 0"
          : "webhook carried no credits_consumed; estimate stands",
  });
  return "reconciled";
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
