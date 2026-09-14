import { currentBillingPeriod, formatPeriodResetLabel, type BillingPeriod } from "./period.js";
import {
  asFitVerdict,
  finalizeLedgerRow,
  getPeriodSpend,
  getUserPeriodSpend,
  insertReservation,
  UNIT_COST,
  type ApolloSpendUnit,
  type ApolloTrigger,
  type FitVerdict,
  type SpendBreakdown,
} from "./ledger.js";
import { getApolloCreditSettings, verdictClearsBar, type ApolloCreditSettings } from "./settings.js";
import { getUserCreditLimit } from "./user-limits.js";

// The ONE place a credit spend is authorized. Policy only -- the ledger does
// the recording, settings supplies the knobs.
//
// Every decision here is FAIL-CLOSED. If we cannot read the budget, we do not
// spend: an outage must not become an unmetered spending window. That is
// deliberately the opposite of isOverDailyLimit's fail-open behaviour, because
// the downside here is money rather than a blocked capture.

/**
 * Proof that a spend was authorized and recorded.
 *
 * The brand cannot be produced outside this module, and apolloFetch takes one
 * as a REQUIRED argument -- so a call site physically cannot reach Apollo
 * without going through reserveEnrichment. That makes bypassing the budget a
 * compile error rather than a code-review convention, which matters because
 * the two existing enrich paths already drifted apart once.
 */
declare const authBrand: unique symbol;

export interface CreditAuthorization {
  readonly [authBrand]: "apollo-credit-authorization";
  readonly periodKey: string;
  /** One leg per credit-bearing unit this authorization funds. */
  readonly legs: AuthorizationLeg[];
}

export interface AuthorizationLeg {
  readonly ledgerId: string;
  readonly unit: ApolloSpendUnit;
  /** Flipped when the leg funds an actual HTTP call, so it can't fund a second. */
  consumed: boolean;
}

export type BlockedReason =
  | "disabled"
  | "store_unavailable"
  | "period_exhausted"
  | "sweep_reserve_exhausted"
  | "user_cap_exhausted"
  | "fit_gate";

export interface BudgetState {
  enabled: boolean;
  period: BillingPeriod;
  /** Human-readable reset date, e.g. "October 4". */
  resetLabel: string;
  budget: number;
  safetyMargin: number;
  /** Credits usable before the safety margin bites. */
  spendable: number;
  spent: number;
  remaining: number;
  /** 0-100, of the full budget. */
  spentPct: number;
  breakdown: SpendBreakdown;
  sweepCap: number;
  phoneStopAt: number;
  /** True once phone reveals are paused but email still works. */
  phoneRevealsPaused: boolean;
  /** True once nothing may be spent. */
  hardStopped: boolean;
  tier: "ok" | "phone_blocked" | "hard_stop";
  settings: ApolloCreditSettings;
}

export interface SpendContext {
  trigger: ApolloTrigger;
  /** Null for the sweep. Required for manual/agent so the personal cap applies. */
  actorEmail: string | null;
  subjectTable: "lead_list_items" | "prospects" | null;
  subjectId: string | null;
  fitVerdict?: string | null;
}

/**
 * Read-only budget snapshot. Drives the Analytics gauge, the admin banner, and
 * the pre-flight cost estimate. Never records anything.
 */
export async function getEnrichmentBudgetState(now: Date = new Date()): Promise<BudgetState> {
  const settings = await getApolloCreditSettings();
  const period = currentBillingPeriod(settings.anchorDay, now);
  const breakdown = await getPeriodSpend(period.key);

  const budget = settings.periodBudget;
  const spendable = Math.max(0, budget - settings.safetyMargin);
  const spent = breakdown.total;
  const spentPct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 100;
  const phoneStopAt = Math.floor((budget * settings.phoneStopPct) / 100);
  const sweepCap = Math.floor((budget * settings.sweepReservePct) / 100);

  const hardStopped = spent >= spendable;
  const phoneRevealsPaused = hardStopped || spent >= phoneStopAt;

  return {
    enabled: settings.enabled,
    period,
    resetLabel: formatPeriodResetLabel(period),
    budget,
    safetyMargin: settings.safetyMargin,
    spendable,
    spent,
    remaining: Math.max(0, spendable - spent),
    spentPct,
    breakdown,
    sweepCap,
    phoneStopAt,
    phoneRevealsPaused,
    hardStopped,
    tier: hardStopped ? "hard_stop" : phoneRevealsPaused ? "phone_blocked" : "ok",
    settings,
  };
}

export type ReserveResult =
  | { ok: false; reason: BlockedReason; message: string; state: BudgetState | null }
  | {
      ok: true;
      auth: CreditAuthorization;
      /** False when the reveal leg was dropped because phones are paused. */
      revealPhone: boolean;
      phoneRevealSkippedReason?: "budget_paused";
      state: BudgetState;
    };

export interface ReserveOptions {
  wantPhoneReveal?: boolean;
  wantOrgEnrich?: boolean;
  /**
   * Set only by the explicit reveal action, when a user has confirmed spending
   * 8 credits on a lead that does not clear the fit bar. Recorded on the ledger
   * row so an admin can see whether the gate is being respected.
   */
  overrideFitGate?: boolean;
}

/**
 * Authorize (and pre-record) a spend.
 *
 * Reservations are written BEFORE the Apollo call so concurrent authorizations
 * can see them; otherwise N simultaneous requests would each read the same
 * pre-spend total and all pass.
 */
export async function reserveEnrichment(
  ctx: SpendContext,
  opts: ReserveOptions = {},
): Promise<ReserveResult> {
  let state: BudgetState;
  try {
    state = await getEnrichmentBudgetState();
  } catch {
    // Cannot read settings or the ledger: refuse. If we can't account for a
    // credit, we can't spend it.
    return {
      ok: false,
      reason: "store_unavailable",
      message: "Apollo credit accounting is unavailable, so enrichment is paused.",
      state: null,
    };
  }

  if (!state.enabled) {
    return {
      ok: false,
      reason: "disabled",
      message: "Apollo enrichment is turned off for this workspace.",
      state,
    };
  }

  if (state.hardStopped) {
    return {
      ok: false,
      reason: "period_exhausted",
      message: `The workspace is out of Apollo credits for this period. Credits reset ${state.resetLabel}.`,
      state,
    };
  }

  const verdict = asFitVerdict(ctx.fitVerdict);

  // Which legs are we asking for? The reveal leg can be dropped without
  // failing the whole call (see below), so it's decided separately.
  const wantOrg = opts.wantOrgEnrich ?? false;
  let revealPhone = opts.wantPhoneReveal ?? false;
  let phoneRevealSkippedReason: "budget_paused" | undefined;

  // Tier: phones stop before emails do, because a reveal is 8x the cost. This
  // drops the expensive leg and keeps the cheap one, so a caller never has to
  // reimplement the policy -- it just gets told the reveal didn't happen.
  if (revealPhone && state.phoneRevealsPaused) {
    revealPhone = false;
    phoneRevealSkippedReason = "budget_paused";
  }

  // The fit gate applies ONLY to the 8-credit reveal, and only when the caller
  // hasn't explicitly overridden it.
  if (revealPhone && !opts.overrideFitGate && !verdictClearsBar(verdict, state.settings.phoneMinVerdict)) {
    return {
      ok: false,
      reason: "fit_gate",
      message: verdict
        ? `Phone reveals are reserved for stronger-fit leads. This lead scored ${verdict}.`
        : "Phone reveals are reserved for scored, stronger-fit leads. This lead has not been scored yet.",
      state,
    };
  }

  const units: ApolloSpendUnit[] = ["person_match"];
  if (revealPhone) units.push("phone_reveal");
  if (wantOrg) units.push("org_enrich");
  const cost = units.reduce((sum, u) => sum + UNIT_COST[u], 0);

  // Sweep containment: automatic spend is capped at its share so a manual
  // request always has credits available.
  if (ctx.trigger === "sweep" && state.breakdown.byTrigger.sweep + cost > state.sweepCap) {
    return {
      ok: false,
      reason: "sweep_reserve_exhausted",
      message: `Automatic enrichment has used its share of this period's credits (${state.sweepCap}). It resumes ${state.resetLabel}.`,
      state,
    };
  }

  // Per-user allowance, so one person can't drain the shared pool. Sweep rows
  // have no actor and are covered by the reserve above instead.
  if (ctx.trigger !== "sweep" && ctx.actorEmail) {
    let limit: number;
    let userSpent: number;
    try {
      [limit, userSpent] = await Promise.all([
        getUserCreditLimit(ctx.actorEmail, state.settings.userDefaultLimit),
        getUserPeriodSpend(state.period.key, ctx.actorEmail),
      ]);
    } catch {
      return {
        ok: false,
        reason: "store_unavailable",
        message: "Apollo credit accounting is unavailable, so enrichment is paused.",
        state,
      };
    }
    if (userSpent + cost > limit) {
      return {
        ok: false,
        reason: "user_cap_exhausted",
        message: `You've used your Apollo credit allowance for this period (${userSpent} of ${limit}). It resets ${state.resetLabel}.`,
        state,
      };
    }
  }

  // Don't let a multi-leg spend straddle the line: check the FULL cost, not
  // just whether there was room for the first credit.
  if (state.spent + cost > state.spendable) {
    return {
      ok: false,
      reason: "period_exhausted",
      message: `This would exceed the workspace's remaining Apollo credits (${state.remaining} left). Credits reset ${state.resetLabel}.`,
      state,
    };
  }

  const legs: AuthorizationLeg[] = [];
  for (const unit of units) {
    const ledgerId = await insertReservation({
      unit,
      periodKey: state.period.key,
      trigger: ctx.trigger,
      actorEmail: ctx.actorEmail,
      subjectTable: ctx.subjectTable,
      subjectId: ctx.subjectId,
      fitVerdict: verdict,
      isOverride: unit === "phone_reveal" ? !!opts.overrideFitGate : false,
    });
    legs.push({ ledgerId, unit, consumed: false });
  }

  const auth = { periodKey: state.period.key, legs } as unknown as CreditAuthorization;
  return { ok: true, auth, revealPhone, phoneRevealSkippedReason, state };
}

/**
 * Claims the leg that funds one HTTP call.
 *
 * Called by apolloFetch, which is why this is exported: it is the interlock
 * that stops a replayed authorization from funding a second call.
 */
export function claimLeg(auth: CreditAuthorization, unit: ApolloSpendUnit): AuthorizationLeg {
  const leg = auth.legs.find((l) => l.unit === unit && !l.consumed);
  if (!leg) {
    throw new Error(
      `Apollo call for "${unit}" was not authorized (no unconsumed credit reservation). ` +
        "Every Apollo request must go through reserveEnrichment.",
    );
  }
  leg.consumed = true;
  return leg;
}

export function findLeg(auth: CreditAuthorization, unit: ApolloSpendUnit): AuthorizationLeg | undefined {
  return auth.legs.find((l) => l.unit === unit);
}

export interface SettleInput {
  personMatch?: { outcome: "match" | "no_match" | "http_error" | "timeout"; apolloPersonId?: string | null };
  phoneReveal?: { outcome: "requested" | "resolved_sync" | "not_requested" | "http_error" | "timeout"; apolloPersonId?: string | null };
  orgEnrich?: { outcome: "match" | "no_match" | "http_error" | "timeout" };
}

/**
 * Closes out every leg. MUST run in a `finally` -- an unsettled reservation
 * keeps consuming budget until the orphan reaper voids it.
 *
 * Failure-mode choices, stated explicitly because they are assumptions about
 * Apollo's billing we cannot verify from code:
 *
 * - `http_error` VOIDS the leg. Apollo is assumed not to bill a rejected
 *   request.
 * - `timeout` KEEPS the leg charged. The request may well have been processed
 *   server-side, and over-counting is safer than over-spending.
 * - `no_match` KEEPS the leg charged -- a match attempt is assumed billable
 *   even when it finds nobody. Tagged so it can be repriced in bulk later if
 *   an invoice says otherwise.
 * - A requested reveal goes to `pending_webhook`, holding all 8 credits until
 *   Apollo's webhook reports the real `credits_consumed`.
 */
export async function settleEnrichment(auth: CreditAuthorization, result: SettleInput): Promise<void> {
  for (const leg of auth.legs) {
    try {
      if (leg.unit === "person_match") {
        const r = result.personMatch;
        if (!r || !leg.consumed) {
          await finalizeLedgerRow(leg.ledgerId, { status: "voided", outcome: "not_called" });
        } else if (r.outcome === "http_error") {
          await finalizeLedgerRow(leg.ledgerId, { status: "voided", outcome: "http_error" });
        } else {
          await finalizeLedgerRow(leg.ledgerId, {
            status: "committed",
            outcome: r.outcome,
            apolloPersonId: r.apolloPersonId ?? null,
          });
        }
        continue;
      }

      if (leg.unit === "phone_reveal") {
        const r = result.phoneReveal;
        if (!r || r.outcome === "not_requested" || !leg.consumed) {
          await finalizeLedgerRow(leg.ledgerId, { status: "voided", outcome: "not_requested" });
        } else if (r.outcome === "http_error") {
          await finalizeLedgerRow(leg.ledgerId, { status: "voided", outcome: "http_error" });
        } else if (r.outcome === "resolved_sync") {
          await finalizeLedgerRow(leg.ledgerId, {
            status: "committed",
            outcome: "revealed_sync",
            apolloPersonId: r.apolloPersonId ?? null,
          });
        } else {
          // "requested" or "timeout": hold the 8 credits and wait for the
          // webhook, which carries Apollo's authoritative credits_consumed.
          await finalizeLedgerRow(leg.ledgerId, {
            status: "pending_webhook",
            outcome: r.outcome === "timeout" ? "reveal_timeout" : "reveal_requested",
            apolloPersonId: r.apolloPersonId ?? null,
          });
        }
        continue;
      }

      const r = result.orgEnrich;
      if (!r || !leg.consumed) {
        await finalizeLedgerRow(leg.ledgerId, { status: "voided", outcome: "not_called" });
      } else {
        await finalizeLedgerRow(leg.ledgerId, {
          status: r.outcome === "http_error" ? "voided" : "committed",
          outcome: r.outcome,
        });
      }
    } catch {
      // A bookkeeping failure must not mask the enrichment result the caller
      // is about to return. The orphan reaper will void anything left
      // `reserved`.
    }
  }
}

export type { ApolloSpendUnit, ApolloTrigger, FitVerdict, SpendBreakdown };
