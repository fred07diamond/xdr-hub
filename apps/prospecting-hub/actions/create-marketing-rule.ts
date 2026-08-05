import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { resourceDeleteByPath, resourcePut } from "@agent-native/core/resources";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { marketingRules, personas, segmentContacts, segments } from "../server/db/schema.js";
import { DEFAULT_LIFECYCLE_STAGES } from "../server/helpers/hubspot-contact-properties.js";
import { requireRole } from "../server/helpers/require-role.js";
import {
  buildSourcingRuleJobContent,
  computeIntervalCron,
  VALID_INTERVAL_HOURS,
} from "../server/helpers/sourcing-rule-jobs.js";

type Db = ReturnType<typeof getDb>;

// Mirrors create-sourcing-rule.ts's own comment/behavior exactly — best-
// effort compensating cleanup for the create-once segment this action
// creates before the job resource / rule row exist.
async function cleanupOrphanedSegment(db: Db, segmentId: string): Promise<void> {
  try {
    await db.delete(segmentContacts).where(eq(segmentContacts.segmentId, segmentId));
    await db.delete(segments).where(eq(segments.id, segmentId));
  } catch (cleanupError) {
    console.error(
      `[create-marketing-rule] Failed to clean up orphaned segment ${segmentId} after a later step failed:`,
      cleanupError,
    );
  }
}

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
    const userEmail = ctx!.userEmail!;

    const persona = await db.select({ id: personas.id }).from(personas).where(eq(personas.id, personaId)).limit(1);
    if (!persona[0]) {
      throw Object.assign(new Error(`Persona ${personaId} not found.`), { statusCode: 404 });
    }

    const now = new Date().toISOString();

    // Create-once stable segment: this rule owns exactly one segment that
    // accumulates matches across every scheduled run — same convention as
    // create-sourcing-rule.ts's own Prospected segment.
    const segmentId = nanoid();
    await db.insert(segments).values({
      id: segmentId,
      name: `${name} (marketing)`,
      ownerEmail: userEmail,
      personaId,
      visibility: "private",
      status: "active",
      filters: null,
      createdAt: now,
    });

    const ruleId = nanoid();
    const cronExpression = computeIntervalCron(intervalHours);
    const jobResourcePath = `jobs/marketing-rule-${ruleId}.md`;
    const jobContent = buildSourcingRuleJobContent({
      cron: cronExpression,
      enabled: true,
      createdBy: userEmail,
      ruleId,
      orgId: ctx?.orgId,
      actionName: "run-marketing-rule-pipeline",
      ruleLabel: "marketing rule",
    });

    try {
      await resourcePut(userEmail, jobResourcePath, jobContent, "text/markdown");
    } catch (err) {
      await cleanupOrphanedSegment(db, segmentId);
      throw err;
    }

    try {
      await db.insert(marketingRules).values({
        id: ruleId,
        name,
        ownerEmail: userEmail,
        personaId,
        lifecycleStages: JSON.stringify(
          lifecycleStages && lifecycleStages.length > 0 ? lifecycleStages : DEFAULT_LIFECYCLE_STAGES,
        ),
        companyAllowList: companyAllowList ? JSON.stringify(companyAllowList) : null,
        companyDenyList: companyDenyList ? JSON.stringify(companyDenyList) : null,
        intervalHours,
        segmentId,
        jobResourcePath,
        status: "active",
        createdAt: now,
      });
    } catch (err) {
      try {
        await resourceDeleteByPath(userEmail, jobResourcePath);
      } catch (cleanupError) {
        console.error(
          `[create-marketing-rule] Failed to clean up orphaned job resource ${jobResourcePath} after the rule row insert failed:`,
          cleanupError,
        );
      }
      await cleanupOrphanedSegment(db, segmentId);
      throw err;
    }

    return { id: ruleId, segmentId, cronExpression };
  },
});
