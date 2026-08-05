import { defineAction } from "@agent-native/core";
import { and, eq } from "@agent-native/core/db/schema";
import { resourceDeleteByPath, resourcePut } from "@agent-native/core/resources";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icps, personas, segmentContacts, segments, sourcingRules, subPersonas } from "../server/db/schema.js";
import {
  buildSourcingRuleJobContent,
  computeIntervalCron,
  VALID_INTERVAL_HOURS,
} from "../server/helpers/sourcing-rule-jobs.js";
import { requireRole } from "../server/helpers/require-role.js";

type Db = ReturnType<typeof getDb>;

// Best-effort compensating cleanup for the create-once segment this action
// creates before the job resource / rule row exist. Not a transaction — just
// undoes what we already wrote so a later-step failure doesn't leave an
// orphaned segment behind. Cleanup failures are logged, never thrown, so the
// original error is always what the caller sees.
async function cleanupOrphanedSegment(db: Db, segmentId: string): Promise<void> {
  try {
    await db.delete(segmentContacts).where(eq(segmentContacts.segmentId, segmentId));
    await db.delete(segments).where(eq(segments.id, segmentId));
  } catch (cleanupError) {
    console.error(
      `[create-sourcing-rule] Failed to clean up orphaned segment ${segmentId} after a later step failed:`,
      cleanupError,
    );
  }
}

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
    const userEmail = ctx!.userEmail!;

    const persona = await db.select({ id: personas.id }).from(personas).where(eq(personas.id, personaId)).limit(1);
    if (!persona[0]) {
      throw Object.assign(new Error(`Persona ${personaId} not found.`), { statusCode: 404 });
    }

    if (subPersonaId) {
      const subPersona = await db
        .select({ id: subPersonas.id })
        .from(subPersonas)
        .where(and(eq(subPersonas.id, subPersonaId), eq(subPersonas.personaId, personaId)))
        .limit(1);
      if (!subPersona[0]) {
        throw Object.assign(new Error(`Sub-persona ${subPersonaId} not found under persona ${personaId}.`), {
          statusCode: 404,
        });
      }
    }

    if (icpId) {
      const icp = await db.select({ id: icps.id }).from(icps).where(eq(icps.id, icpId)).limit(1);
      if (!icp[0]) {
        throw Object.assign(new Error(`ICP ${icpId} not found.`), { statusCode: 404 });
      }
    }

    const now = new Date().toISOString();

    // Create-once stable segment: this rule owns exactly one segment that
    // accumulates matches across every scheduled run. It deliberately has
    // no `filters` — it's populated by the Task 7 pipeline action, not by
    // the generic persona/score-threshold query create-segment.ts uses.
    const segmentId = nanoid();
    await db.insert(segments).values({
      id: segmentId,
      name: `${name} (sourced)`,
      ownerEmail: userEmail,
      personaId,
      visibility: "private",
      status: "active",
      filters: null,
      createdAt: now,
    });

    const ruleId = nanoid();
    const cronExpression = computeIntervalCron(intervalHours);
    const jobResourcePath = `jobs/sourcing-rule-${ruleId}.md`;
    const jobContent = buildSourcingRuleJobContent({
      cron: cronExpression,
      enabled: true,
      createdBy: userEmail,
      ruleId,
      orgId: ctx?.orgId,
    });

    try {
      await resourcePut(userEmail, jobResourcePath, jobContent, "text/markdown");
    } catch (err) {
      // Job resource write failed — the segment is now orphaned (no rule
      // will ever own it). Undo it before re-throwing the original error.
      await cleanupOrphanedSegment(db, segmentId);
      throw err;
    }

    try {
      await db.insert(sourcingRules).values({
        id: ruleId,
        name,
        ownerEmail: userEmail,
        personaId,
        subPersonaId: subPersonaId ?? null,
        icpId: icpId ?? null,
        companyAllowList: companyAllowList ? JSON.stringify(companyAllowList) : null,
        companyDenyList: companyDenyList ? JSON.stringify(companyDenyList) : null,
        manualTitleKeywords: manualTitleKeywords && manualTitleKeywords.length > 0 ? JSON.stringify(manualTitleKeywords) : null,
        manualSeniorities: manualSeniorities && manualSeniorities.length > 0 ? JSON.stringify(manualSeniorities) : null,
        minLinkedinFollowers: minLinkedinFollowers ?? null,
        previousCompanyName: previousCompanyName ?? null,
        desiredVolume,
        // Legacy columns are NOT NULL but no longer meaningful — the schedule
        // is now driven entirely by intervalHours. Placeholder values only.
        readyByTime: "00:00",
        leadHours: 1,
        intervalHours,
        segmentId,
        jobResourcePath,
        status: "active",
        createdAt: now,
      });
    } catch (err) {
      // Rule row insert failed — both the segment and the job resource are
      // now orphaned (no rule row references them). Undo both before
      // re-throwing the original error.
      try {
        await resourceDeleteByPath(userEmail, jobResourcePath);
      } catch (cleanupError) {
        console.error(
          `[create-sourcing-rule] Failed to clean up orphaned job resource ${jobResourcePath} after the rule row insert failed:`,
          cleanupError,
        );
      }
      await cleanupOrphanedSegment(db, segmentId);
      throw err;
    }

    return { id: ruleId, segmentId, cronExpression };
  },
});
