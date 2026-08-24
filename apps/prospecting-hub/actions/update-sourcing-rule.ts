import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { resourceGetByPath, resourcePut } from "@agent-native/core/resources";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icps, sourcingRules } from "../server/db/schema.js";
import {
  computeIntervalCron,
  updateJobFrontmatterField,
  VALID_INTERVAL_HOURS,
} from "../server/helpers/sourcing-rule-jobs.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "Update a sourcing rule's filters, volume, schedule, or active status. Owner or admin only. Rewrites the underlying job resource's schedule/enabled frontmatter when relevant fields change.",
  schema: z.object({
    id: z.string().min(1),
    name: z.string().min(1).nullish(),
    icpId: z.string().nullish(),
    companyAllowList: z.array(z.string()).nullish(),
    companyDenyList: z.array(z.string()).nullish(),
    companyAllowListOwnerId: z.string().nullish(),
    companyDenyListOwnerId: z.string().nullish(),
    manualTitleKeywords: z.array(z.string()).nullish(),
    manualSeniorities: z.array(z.string()).nullish(),
    minLinkedinFollowers: z.number().int().min(0).nullish(),
    previousCompanyName: z.string().nullish(),
    desiredVolume: z.number().int().min(1).max(1000).nullish(),
    intervalHours: z
      .number()
      .int()
      .refine(
        (v) => VALID_INTERVAL_HOURS.includes(v as (typeof VALID_INTERVAL_HOURS)[number]),
        `Must be one of ${VALID_INTERVAL_HOURS.join(", ")} hours`,
      )
      .nullish(),
    status: z.enum(["active", "paused"]).nullish(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async (
    {
      id,
      name,
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
      status,
    },
    ctx,
  ) => {
    const role = await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    const existing = await db.select().from(sourcingRules).where(eq(sourcingRules.id, id)).limit(1);
    if (!existing[0]) {
      return { ok: false, error: `Sourcing rule ${id} not found.` };
    }
    const rule = existing[0];

    if (rule.ownerEmail !== ctx!.userEmail! && role !== "admin") {
      return { ok: false, error: "Only the sourcing rule's owner or a manager can update this." };
    }

    if (icpId) {
      const icp = await db.select({ id: icps.id }).from(icps).where(eq(icps.id, icpId)).limit(1);
      if (!icp[0]) {
        return { ok: false, error: `ICP ${icpId} not found.` };
      }
    }

    // scheduleChanged is only true when the caller explicitly supplies a
    // fresh intervalHours in this call, so it's always non-null below —
    // there's no legacy readyByTime/leadHours cron path to fall back to
    // here. (A pre-migration rule that has never been given an
    // intervalHours simply never hits this branch: its schedule is left
    // untouched by this action until someone explicitly sets one.)
    const scheduleChanged = intervalHours != null;
    const statusChanged = status != null && status !== rule.status;

    if ((scheduleChanged || statusChanged) && rule.jobResourcePath) {
      const resource = await resourceGetByPath(rule.ownerEmail, rule.jobResourcePath);
      if (resource) {
        let content = resource.content;
        if (scheduleChanged) {
          const cronExpression = computeIntervalCron(intervalHours!);
          content = updateJobFrontmatterField(content, "schedule", `"${cronExpression}"`);
        }
        if (statusChanged) {
          content = updateJobFrontmatterField(content, "enabled", String(status === "active"));
        }
        await resourcePut(rule.ownerEmail, rule.jobResourcePath, content, resource.mimeType);
      }
    }

    await db
      .update(sourcingRules)
      .set({
        ...(name != null ? { name } : {}),
        ...(icpId !== undefined ? { icpId } : {}),
        ...(companyAllowList !== undefined ? { companyAllowList: companyAllowList ? JSON.stringify(companyAllowList) : null } : {}),
        ...(companyDenyList !== undefined ? { companyDenyList: companyDenyList ? JSON.stringify(companyDenyList) : null } : {}),
        ...(companyAllowListOwnerId !== undefined ? { companyAllowListOwnerId } : {}),
        ...(companyDenyListOwnerId !== undefined ? { companyDenyListOwnerId } : {}),
        ...(manualTitleKeywords !== undefined
          ? { manualTitleKeywords: manualTitleKeywords && manualTitleKeywords.length > 0 ? JSON.stringify(manualTitleKeywords) : null }
          : {}),
        ...(manualSeniorities !== undefined
          ? { manualSeniorities: manualSeniorities && manualSeniorities.length > 0 ? JSON.stringify(manualSeniorities) : null }
          : {}),
        ...(minLinkedinFollowers !== undefined ? { minLinkedinFollowers } : {}),
        ...(previousCompanyName !== undefined ? { previousCompanyName } : {}),
        ...(desiredVolume != null ? { desiredVolume } : {}),
        ...(intervalHours != null ? { intervalHours } : {}),
        ...(status != null ? { status } : {}),
      })
      .where(eq(sourcingRules.id, id));

    return { ok: true, id };
  },
});
