import { defineAction } from "@agent-native/core";
import { getWorkspaceRole } from "@xdr-hub/shared/server";
import { z } from "zod";

import { getEnrichmentBudgetState } from "../server/helpers/apollo-credits/guard.js";
import { getSpendByUser } from "../server/helpers/apollo-credits/ledger.js";
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

    const isAdmin = (await getWorkspaceRole(ctx?.userEmail).catch(() => "none")) === "admin";

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

      phoneStopAt: state.phoneStopAt,
      phoneStopPct: state.settings.phoneStopPct,
      thresholds: state.settings.thresholds,

      // Admin-only, omitted from the response entirely for everyone else.
      ...(isAdmin ? { topSpenders: await getSpendByUser(state.period.key) } : {}),
    };
  },
});
