import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { resourceDeleteByPath, resourcePut } from "@agent-native/core/resources";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { marketingRules, prospectPullPlans, sourcingRules } from "../server/db/schema.js";
import { createMarketingRuleCore } from "../server/helpers/create-marketing-rule-core.js";
import { createSourcingRuleCore } from "../server/helpers/create-sourcing-rule-core.js";
import { requireRole } from "../server/helpers/require-role.js";
import {
  buildPullPlanReconcileJobContent,
  computeIntervalCron,
  pullPlanReconcileJobResourcePath,
  VALID_INTERVAL_HOURS,
} from "../server/helpers/sourcing-rule-jobs.js";

// A composition rule fans out into one sourcing rule (CommonRoom/Prospector,
// genuinely volume-targeted) and, when HubSpot is enabled, one marketing rule
// (HubSpot, an always-on background contributor -- see reconcile-prospect-
// pull-plan.ts's own comment for why HubSpot can't be volume-targeted the
// way CommonRoom can) PER PERSONA in the mix, reusing create-sourcing-rule-
// core.ts / create-marketing-rule-core.ts completely unmodified. This action
// only owns the mix math and the plan's own reconcile job.
export default defineAction({
  description:
    "Create a prospect pull plan — an XDR sets a total volume and a persona percentage mix (e.g. 50 total, 40% Design / 30% Engineering / 30% Product), and the plan creates one sourcing rule and (optionally) one marketing rule per persona at the matching volume, plus a reconcile job that tops up any shortfall from already-captured LinkedIn leads and generates a refill-nudge link when that pool is short too.",
  schema: z.object({
    name: z.string().min(1),
    totalVolume: z.number().int().min(1).max(1000),
    intervalHours: z.number().int().refine(
      (v) => VALID_INTERVAL_HOURS.includes(v as (typeof VALID_INTERVAL_HOURS)[number]),
      `Must be one of ${VALID_INTERVAL_HOURS.join(", ")} hours`,
    ),
    personaMix: z
      .array(z.object({ personaId: z.string().min(1), targetPercent: z.number().min(0).max(100) }))
      .min(1),
    includeHubspot: z.boolean().default(true),
    lifecycleStages: z.array(z.string()).nullish(),
    companyAllowList: z.array(z.string()).nullish(),
    companyDenyList: z.array(z.string()).nullish(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async (
    { name, totalVolume, intervalHours, personaMix, includeHubspot, lifecycleStages, companyAllowList, companyDenyList },
    ctx,
  ) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();
    const ownerEmail = ctx!.userEmail!;
    const orgId = ctx?.orgId;

    const percentSum = personaMix.reduce((sum, p) => sum + p.targetPercent, 0);
    if (percentSum < 99 || percentSum > 101) {
      throw Object.assign(new Error(`Persona mix percentages must sum to 100 (got ${percentSum}).`), {
        statusCode: 400,
      });
    }

    const sourcingRuleIds: { personaId: string; sourcingRuleId: string }[] = [];
    const marketingRuleIds: { personaId: string; marketingRuleId: string }[] = [];

    // Best-effort compensating cleanup if a later persona in the mix fails --
    // undoes every sourcing/marketing rule already created for this plan so a
    // partial failure doesn't leave orphaned rules with no plan to own them.
    // Mirrors delete-sourcing-rule.ts/delete-marketing-rule.ts's own delete
    // shape (job resource + rule row; segment/contacts intentionally kept --
    // moot here since nothing has synced yet for a rule this fresh).
    async function cleanupCreatedRules(): Promise<void> {
      for (const { sourcingRuleId } of sourcingRuleIds) {
        try {
          const rows = await db.select().from(sourcingRules).where(eq(sourcingRules.id, sourcingRuleId)).limit(1);
          if (rows[0]?.jobResourcePath) await resourceDeleteByPath(ownerEmail, rows[0].jobResourcePath);
          await db.delete(sourcingRules).where(eq(sourcingRules.id, sourcingRuleId));
        } catch (err) {
          console.error(`[create-prospect-pull-plan] Failed to clean up orphaned sourcing rule ${sourcingRuleId}:`, err);
        }
      }
      for (const { marketingRuleId } of marketingRuleIds) {
        try {
          const rows = await db.select().from(marketingRules).where(eq(marketingRules.id, marketingRuleId)).limit(1);
          if (rows[0]?.jobResourcePath) await resourceDeleteByPath(ownerEmail, rows[0].jobResourcePath);
          await db.delete(marketingRules).where(eq(marketingRules.id, marketingRuleId));
        } catch (err) {
          console.error(`[create-prospect-pull-plan] Failed to clean up orphaned marketing rule ${marketingRuleId}:`, err);
        }
      }
    }

    try {
      for (const { personaId, targetPercent } of personaMix) {
        const desiredVolume = Math.max(1, Math.round((totalVolume * targetPercent) / 100));

        const sourcingResult = await createSourcingRuleCore(db, {
          name: `${name} — ${personaId}`,
          ownerEmail,
          orgId,
          personaId,
          companyAllowList,
          companyDenyList,
          desiredVolume,
          intervalHours,
        });
        sourcingRuleIds.push({ personaId, sourcingRuleId: sourcingResult.id });

        if (includeHubspot) {
          const marketingResult = await createMarketingRuleCore(db, {
            name: `${name} — ${personaId}`,
            ownerEmail,
            orgId,
            personaId,
            lifecycleStages,
            companyAllowList,
            companyDenyList,
            intervalHours,
          });
          marketingRuleIds.push({ personaId, marketingRuleId: marketingResult.id });
        }
      }
    } catch (err) {
      await cleanupCreatedRules();
      throw err;
    }

    const planId = nanoid();
    const cronExpression = computeIntervalCron(intervalHours);
    const jobResourcePath = pullPlanReconcileJobResourcePath(planId);
    const jobContent = buildPullPlanReconcileJobContent({
      cron: cronExpression,
      enabled: true,
      createdBy: ownerEmail,
      planId,
      orgId,
    });

    try {
      await resourcePut(ownerEmail, jobResourcePath, jobContent, "text/markdown");
    } catch (err) {
      await cleanupCreatedRules();
      throw err;
    }

    const now = new Date().toISOString();
    try {
      await db.insert(prospectPullPlans).values({
        id: planId,
        name,
        ownerEmail,
        totalVolume,
        intervalHours,
        personaMix: JSON.stringify(personaMix),
        sourcingRuleIds: JSON.stringify(sourcingRuleIds),
        marketingRuleIds: marketingRuleIds.length > 0 ? JSON.stringify(marketingRuleIds) : null,
        lastReconciledAt: null,
        jobResourcePath,
        status: "active",
        createdAt: now,
      });
    } catch (err) {
      try {
        await resourceDeleteByPath(ownerEmail, jobResourcePath);
      } catch (cleanupError) {
        console.error(
          `[create-prospect-pull-plan] Failed to clean up orphaned job resource ${jobResourcePath} after the plan row insert failed:`,
          cleanupError,
        );
      }
      await cleanupCreatedRules();
      throw err;
    }

    return { id: planId, sourcingRuleIds, marketingRuleIds, cronExpression };
  },
});
