import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { resourceGetByPath, resourcePut } from "@agent-native/core/resources";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { sourcingRules } from "../server/db/schema.js";
import { computeSourcingRuleCron, updateJobFrontmatterField } from "../server/helpers/sourcing-rule-jobs.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "Update a sourcing rule's filters, volume, schedule, or active status. Owner or admin only. Rewrites the underlying job resource's schedule/enabled frontmatter when relevant fields change.",
  schema: z.object({
    id: z.string().min(1),
    name: z.string().min(1).nullish(),
    companyAllowList: z.array(z.string()).nullish(),
    companyDenyList: z.array(z.string()).nullish(),
    desiredVolume: z.number().int().min(1).max(200).nullish(),
    readyByTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM 24-hour format").nullish(),
    leadHours: z.number().int().min(1).max(12).nullish(),
    status: z.enum(["active", "paused"]).nullish(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async (
    { id, name, companyAllowList, companyDenyList, desiredVolume, readyByTime, leadHours, status },
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

    const nextReadyByTime = readyByTime ?? rule.readyByTime;
    const nextLeadHours = leadHours ?? rule.leadHours;
    const scheduleChanged = readyByTime != null || leadHours != null;
    const statusChanged = status != null && status !== rule.status;

    if ((scheduleChanged || statusChanged) && rule.jobResourcePath) {
      const resource = await resourceGetByPath(rule.ownerEmail, rule.jobResourcePath);
      if (resource) {
        let content = resource.content;
        if (scheduleChanged) {
          const cronExpression = computeSourcingRuleCron(nextReadyByTime, nextLeadHours);
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
        ...(companyAllowList !== undefined ? { companyAllowList: companyAllowList ? JSON.stringify(companyAllowList) : null } : {}),
        ...(companyDenyList !== undefined ? { companyDenyList: companyDenyList ? JSON.stringify(companyDenyList) : null } : {}),
        ...(desiredVolume != null ? { desiredVolume } : {}),
        ...(readyByTime != null ? { readyByTime } : {}),
        ...(leadHours != null ? { leadHours } : {}),
        ...(status != null ? { status } : {}),
      })
      .where(eq(sourcingRules.id, id));

    return { ok: true, id };
  },
});
