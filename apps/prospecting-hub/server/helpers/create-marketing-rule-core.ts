import { eq } from "@agent-native/core/db/schema";
import { resourceDeleteByPath, resourcePut } from "@agent-native/core/resources";
import { nanoid } from "nanoid";
import { getDb } from "../db/index.js";
import { marketingRules, personas, segmentContacts, segments } from "../db/schema.js";
import { DEFAULT_LIFECYCLE_STAGES } from "./hubspot-contact-properties.js";
import { buildSourcingRuleJobContent, computeIntervalCron } from "./sourcing-rule-jobs.js";

type Db = ReturnType<typeof getDb>;

// Extracted from create-marketing-rule.ts so create-prospect-pull-plan.ts can
// create one marketing rule per persona in a mix without duplicating the
// segment-creation/job-creation/compensating-cleanup logic. create-marketing-
// rule.ts itself is a thin wrapper around this now -- its own behavior is
// unchanged.
async function cleanupOrphanedSegment(db: Db, segmentId: string): Promise<void> {
  try {
    await db.delete(segmentContacts).where(eq(segmentContacts.segmentId, segmentId));
    await db.delete(segments).where(eq(segments.id, segmentId));
  } catch (cleanupError) {
    console.error(
      `[create-marketing-rule-core] Failed to clean up orphaned segment ${segmentId} after a later step failed:`,
      cleanupError,
    );
  }
}

export interface CreateMarketingRuleCoreParams {
  name: string;
  ownerEmail: string;
  orgId: string | null | undefined;
  personaId: string;
  lifecycleStages?: string[] | null;
  companyAllowList?: string[] | null;
  companyDenyList?: string[] | null;
  intervalHours: number;
}

export interface CreateMarketingRuleCoreResult {
  id: string;
  segmentId: string;
  cronExpression: string;
}

export async function createMarketingRuleCore(
  db: Db,
  params: CreateMarketingRuleCoreParams,
): Promise<CreateMarketingRuleCoreResult> {
  const { name, ownerEmail, orgId, personaId, lifecycleStages, companyAllowList, companyDenyList, intervalHours } = params;

  const persona = await db.select({ id: personas.id }).from(personas).where(eq(personas.id, personaId)).limit(1);
  if (!persona[0]) {
    throw Object.assign(new Error(`Persona ${personaId} not found.`), { statusCode: 404 });
  }

  const now = new Date().toISOString();

  const segmentId = nanoid();
  await db.insert(segments).values({
    id: segmentId,
    name: `${name} (marketing)`,
    ownerEmail,
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
    createdBy: ownerEmail,
    ruleId,
    orgId,
    actionName: "run-marketing-rule-pipeline",
    ruleLabel: "marketing rule",
  });

  try {
    await resourcePut(ownerEmail, jobResourcePath, jobContent, "text/markdown");
  } catch (err) {
    await cleanupOrphanedSegment(db, segmentId);
    throw err;
  }

  try {
    await db.insert(marketingRules).values({
      id: ruleId,
      name,
      ownerEmail,
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
      await resourceDeleteByPath(ownerEmail, jobResourcePath);
    } catch (cleanupError) {
      console.error(
        `[create-marketing-rule-core] Failed to clean up orphaned job resource ${jobResourcePath} after the rule row insert failed:`,
        cleanupError,
      );
    }
    await cleanupOrphanedSegment(db, segmentId);
    throw err;
  }

  return { id: ruleId, segmentId, cronExpression };
}
