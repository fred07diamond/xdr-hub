import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { resourceGetByPath, resourcePut } from "@agent-native/core/resources";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { marketingRules } from "../server/db/schema.js";
import {
  computeIntervalCron,
  updateJobFrontmatterField,
  VALID_INTERVAL_HOURS,
} from "../server/helpers/sourcing-rule-jobs.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "Update a Marketing rule's lifecycle-stage filter, company allow/deny list, schedule, or active status. Owner or admin only. Rewrites the underlying job resource's schedule/enabled frontmatter when relevant fields change.",
  schema: z.object({
    id: z.string().min(1),
    name: z.string().min(1).nullish(),
    lifecycleStages: z.array(z.string()).min(1).nullish(),
    companyAllowList: z.array(z.string()).nullish(),
    companyDenyList: z.array(z.string()).nullish(),
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
  run: async ({ id, name, lifecycleStages, companyAllowList, companyDenyList, intervalHours, status }, ctx) => {
    const role = await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    const existing = await db.select().from(marketingRules).where(eq(marketingRules.id, id)).limit(1);
    if (!existing[0]) {
      return { ok: false, error: `Marketing rule ${id} not found.` };
    }
    const rule = existing[0];

    if (rule.ownerEmail !== ctx!.userEmail! && role !== "admin") {
      return { ok: false, error: "Only the marketing rule's owner or a manager can update this." };
    }

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
      .update(marketingRules)
      .set({
        ...(name != null ? { name } : {}),
        ...(lifecycleStages && lifecycleStages.length > 0 ? { lifecycleStages: JSON.stringify(lifecycleStages) } : {}),
        ...(companyAllowList !== undefined ? { companyAllowList: companyAllowList ? JSON.stringify(companyAllowList) : null } : {}),
        ...(companyDenyList !== undefined ? { companyDenyList: companyDenyList ? JSON.stringify(companyDenyList) : null } : {}),
        ...(intervalHours != null ? { intervalHours } : {}),
        ...(status != null ? { status } : {}),
      })
      .where(eq(marketingRules.id, id));

    return { ok: true, id };
  },
});
