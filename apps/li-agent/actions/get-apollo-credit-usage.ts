import { defineAction } from "@agent-native/core";
import { getWorkspaceRole } from "@xdr-hub/shared/server";
import { z } from "zod";

import { getEnrichmentBudgetState } from "../server/helpers/apollo-credits/guard.js";
import { getSpendByUser } from "../server/helpers/apollo-credits/ledger.js";
import { getUserCreditLimit } from "../server/helpers/apollo-credits/user-limits.js";
import { maybeNotifyCreditThresholds } from "../server/helpers/apollo-credits/notify-thresholds.js";

// Full spend picture for the Analytics gauge and the admin banner.
//
// Readable by any signed-in member (same level as get-analytics), because the
// gauge is genuinely useful to an xDR deciding whether to burn credits today.
// `topSpenders` is the one admin-only field and is omitted SERVER-side rather
// than hidden by the client.
export default defineAction({
  description:
    "Apollo credit usage for the current billing period: spend against budget, the email/phone and manual/automatic splits, override count, and (admins only) per-user totals.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_input, ctx) => {
    const state = await getEnrichmentBudgetState();

    // Opening Analytics is also a chance to notice a threshold crossed by a
    // WEBHOOK reconciliation, which raises recorded spend with no enrichment
    // in flight and so never passes through settleEnrichment. Best-effort and
    // never allowed to fail the read.
    void maybeNotifyCreditThresholds(state).catch(() => {});

    // requiresAuth guarantees an email, but the type does not -- and an absent
    // one must read as "not admin" rather than throw, since the gauge itself is
    // readable by every member.
    const email = ctx?.userEmail;
    const isAdmin = email
      ? (await getWorkspaceRole(email).catch(() => "none")) === "admin"
      : false;

    return {
      enabled: state.enabled,
      tier: state.tier,
      periodStart: state.period.key,
      periodEnd: state.period.endIso,
      resetLabel: state.resetLabel,
      anchorDay: state.period.anchorDay,

      budget: state.budget,
      safetyMargin: state.safetyMargin,
      spent: state.spent,
      remaining: state.remaining,
      spentPct: Math.round(state.spentPct * 10) / 10,

      // Credits vs CALL COUNTS are both reported: a reveal is 8:1, so "8,256
      // credits" and "1,032 reveals" answer different questions and one cannot
      // be derived from the other without knowing the mix.
      emailCredits: state.breakdown.byUnit.person_match,
      emailCalls: state.breakdown.countByUnit.person_match,
      phoneCredits: state.breakdown.byUnit.phone_reveal,
      phoneCalls: state.breakdown.countByUnit.phone_reveal,

      sweepCredits: state.breakdown.byTrigger.sweep,
      manualCredits: state.breakdown.byTrigger.manual + state.breakdown.byTrigger.agent,
      sweepCap: state.sweepCap,

      // The number that tells an admin whether the fit gate is being
      // respected or routinely clicked through.
      overrideCount: state.breakdown.overrideCount,
      overrideCredits: state.breakdown.overrideCredits,

      // The waste picture. `emptyCalls` is reported even though it is free,
      // because a column of "No email on file" reads as money burned unless
      // the page says outright that it was not charged.
      wastedCredits: state.breakdown.wastedCredits,
      lowFitCredits: state.breakdown.lowFitCredits,
      emptyCalls: state.breakdown.emptyCalls,

      phoneStopAt: state.phoneStopAt,
      phoneStopPct: state.settings.phoneStopPct,
      thresholds: state.settings.thresholds,

      // Per-user rows are needed either way: an admin sees everyone, and a
      // non-admin still needs their OWN figures for the "Your usage" panel.
      // One query serves both; the difference is what gets returned.
      ...(await perUser(state, email, isAdmin)),
    };
  },
});

/**
 * Splits the per-user spend into the caller's own row and (for admins) the
 * whole list.
 *
 * `mine` is deliberately available to every signed-in member. An xDR deciding
 * whether to burn a reveal needs to know their own remaining allowance, and
 * making that admin-only would mean the cap silently stops them with no way to
 * see it coming.
 */
async function perUser(
  state: Awaited<ReturnType<typeof getEnrichmentBudgetState>>,
  email: string | undefined,
  isAdmin: boolean,
) {
  const rows = await getSpendByUser(state.period.key).catch(() => []);
  const lower = email?.toLowerCase() ?? null;
  const own = lower ? rows.find((r) => r.actorEmail.toLowerCase() === lower) : undefined;

  const limit = lower
    ? await getUserCreditLimit(lower, state.settings.userDefaultLimit).catch(
        () => state.settings.userDefaultLimit,
      )
    : state.settings.userDefaultLimit;

  const spent = own?.credits ?? 0;

  return {
    mine: {
      email: lower,
      credits: spent,
      emailCredits: own?.emailCredits ?? 0,
      phoneCredits: own?.phoneCredits ?? 0,
      delivered: own?.delivered ?? 0,
      wasted: own?.wasted ?? 0,
      lowFit: own?.lowFit ?? 0,
      limit,
      remaining: Math.max(0, limit - spent),
      // Whether this allowance is the workspace default or one an admin set
      // for this person specifically -- Apollo words its own panel as "you
      // have a credit limit set", and which kind it is matters if you want it
      // changed.
      isDefaultLimit: limit === state.settings.userDefaultLimit,
    },
    ...(isAdmin ? { topSpenders: rows } : {}),
  };
}
