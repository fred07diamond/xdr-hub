import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { getApolloCreditSettings } from "../server/helpers/apollo-credits/settings.js";
import { currentBillingPeriod, formatPeriodResetLabel } from "../server/helpers/apollo-credits/period.js";
import { requireAdmin } from "../server/helpers/require-admin.js";

// The raw admin knobs, for the Settings card's form inputs.
//
// Separate from get-apollo-credit-usage (which any member can read) because
// these are configuration rather than status: the verdict bars, safety margin
// and sweep share say how the workspace has chosen to spend, and only an admin
// can change them.
export default defineAction({
  description: "Current Apollo credit governance settings for the admin settings form.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_input, ctx) => {
    await requireAdmin(ctx);
    const settings = await getApolloCreditSettings();
    const period = currentBillingPeriod(settings.anchorDay);
    return {
      ...settings,
      periodStart: period.key,
      resetLabel: formatPeriodResetLabel(period),
    };
  },
});
