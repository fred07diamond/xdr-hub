import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { createMarketingRuleCore } from "../server/helpers/create-marketing-rule-core.js";
import { requireRole } from "../server/helpers/require-role.js";
import { VALID_INTERVAL_HOURS } from "../server/helpers/sourcing-rule-jobs.js";

export default defineAction({
  description:
    "Create a Marketing rule — a per-XDR scheduled configuration for the HubSpot-lifecycle-stage pipeline that targets a persona and syncs every currently-qualifying HubSpot contact (default lifecycle stages RAW/MEL/QL) on a recurring cron.",
  schema: z.object({
    name: z.string().min(1),
    personaId: z.string().min(1),
    lifecycleStages: z.array(z.string()).min(1).nullish(),
    companyAllowList: z.array(z.string()).nullish(),
    companyDenyList: z.array(z.string()).nullish(),
    intervalHours: z.number().int().refine(
      (v) => VALID_INTERVAL_HOURS.includes(v as (typeof VALID_INTERVAL_HOURS)[number]),
      `Must be one of ${VALID_INTERVAL_HOURS.join(", ")} hours`,
    ),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ name, personaId, lifecycleStages, companyAllowList, companyDenyList, intervalHours }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    return createMarketingRuleCore(db, {
      name,
      ownerEmail: ctx!.userEmail!,
      orgId: ctx?.orgId,
      personaId,
      lifecycleStages,
      companyAllowList,
      companyDenyList,
      intervalHours,
    });
  },
});
