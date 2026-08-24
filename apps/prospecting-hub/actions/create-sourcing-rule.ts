import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { createSourcingRuleCore } from "../server/helpers/create-sourcing-rule-core.js";
import { VALID_INTERVAL_HOURS } from "../server/helpers/sourcing-rule-jobs.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "Create a sourcing rule — a per-XDR scheduled configuration for the CommonRoom-Prospector pipeline that targets a persona/sub-persona, applies company filters, and runs on a recurring cron computed from the chosen interval.",
  schema: z.object({
    name: z.string().min(1),
    personaId: z.string().min(1),
    subPersonaId: z.string().nullish(),
    icpId: z.string().nullish(),
    companyAllowList: z.array(z.string()).nullish(),
    companyDenyList: z.array(z.string()).nullish(),
    companyAllowListOwnerId: z
      .string()
      .nullish()
      .describe("HubSpot owner id — when set, that owner's current book of business is resolved live at every run and unioned with companyAllowList"),
    companyDenyListOwnerId: z
      .string()
      .nullish()
      .describe("HubSpot owner id — when set, that owner's current book of business is resolved live at every run and unioned with companyDenyList"),
    manualTitleKeywords: z.array(z.string()).nullish(),
    manualSeniorities: z.array(z.string()).nullish(),
    minLinkedinFollowers: z.number().int().min(0).nullish(),
    previousCompanyName: z.string().nullish(),
    desiredVolume: z.number().int().min(1).max(1000).default(20),
    intervalHours: z.number().int().refine(
      (v) => VALID_INTERVAL_HOURS.includes(v as (typeof VALID_INTERVAL_HOURS)[number]),
      `Must be one of ${VALID_INTERVAL_HOURS.join(", ")} hours`,
    ),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async (
    {
      name,
      personaId,
      subPersonaId,
      icpId,
      companyAllowList,
      companyDenyList,
      companyAllowListOwnerId,
      companyDenyListOwnerId,
      manualTitleKeywords,
      manualSeniorities,
      minLinkedinFollowers,
      previousCompanyName,
      desiredVolume,
      intervalHours,
    },
    ctx,
  ) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    return createSourcingRuleCore(db, {
      name,
      ownerEmail: ctx!.userEmail!,
      orgId: ctx?.orgId,
      personaId,
      subPersonaId,
      icpId,
      companyAllowList,
      companyDenyList,
      companyAllowListOwnerId,
      companyDenyListOwnerId,
      manualTitleKeywords,
      manualSeniorities,
      minLinkedinFollowers,
      previousCompanyName,
      desiredVolume,
      intervalHours,
    });
  },
});
