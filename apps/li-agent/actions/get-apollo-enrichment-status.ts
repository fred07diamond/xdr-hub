import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { getEnrichmentBudgetState } from "../server/helpers/apollo-credits/guard.js";
import { getUserCreditLimit } from "../server/helpers/apollo-credits/user-limits.js";
import { getUserPeriodSpend } from "../server/helpers/apollo-credits/ledger.js";

// What the client needs to render enrichment controls honestly: is it on, how
// many credits are left, and is the caller personally out.
//
// Readable by ANY signed-in member, not just admins -- the per-row Enrich
// button and the bulk cost estimate both need `remaining`, and hiding it would
// mean users discovering a closed budget only by clicking into a rejection.
// Aggregates only: no other user's spend and no admin-only figures are
// exposed here (see get-apollo-credit-usage for those).
//
// The server is the real gate. This is presentational, and none of it is
// trusted -- reserveEnrichment re-checks everything.
export default defineAction({
  description:
    "Current Apollo enrichment availability for the calling user: whether enrichment is enabled, how many workspace credits remain this period, whether phone reveals are paused, and the caller's own remaining personal allowance.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_input, ctx) => {
    let state;
    try {
      state = await getEnrichmentBudgetState();
    } catch {
      // Report as unavailable rather than throwing: the UI renders a disabled
      // control with a reason, which is more useful than an error boundary.
      return {
        enabled: false,
        unavailable: true,
        phoneRevealsEnabled: false,
        message: "Apollo credit accounting is unavailable, so enrichment is paused.",
      };
    }

    const email = ctx?.userEmail ?? null;
    let userRemaining: number | null = null;
    let userLimit: number | null = null;
    if (email) {
      try {
        const [limit, spent] = await Promise.all([
          getUserCreditLimit(email, state.settings.userDefaultLimit),
          getUserPeriodSpend(state.period.key, email),
        ]);
        userLimit = limit;
        userRemaining = Math.max(0, limit - spent);
      } catch {
        // Leave null -- the client treats an unknown personal allowance as
        // "the workspace number governs", and the server still enforces it.
      }
    }

    return {
      enabled: state.enabled,
      unavailable: false,
      // Combines the workspace tier and the caller's own allowance, so a
      // button can be disabled for the right reason.
      phoneRevealsEnabled: state.enabled && !state.phoneRevealsPaused,
      tier: state.tier,
      periodEnd: state.period.endIso,
      resetLabel: state.resetLabel,
      budget: state.budget,
      spent: state.spent,
      remaining: state.remaining,
      spentPct: Math.round(state.spentPct),
      phoneStopPct: state.settings.phoneStopPct,
      userLimit,
      userRemaining,
      // Cost per unit, so the client's estimate can never drift from the
      // server's pricing.
      costPerEmail: 1,
      costPerPhoneReveal: 8,
    };
  },
});
