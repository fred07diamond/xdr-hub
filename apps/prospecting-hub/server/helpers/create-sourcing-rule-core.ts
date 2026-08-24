import { eq, and } from "@agent-native/core/db/schema";
import { resourceDeleteByPath, resourcePut } from "@agent-native/core/resources";
import { nanoid } from "nanoid";
import { getDb } from "../db/index.js";
import { icps, personas, segmentContacts, segments, sourcingRules, subPersonas } from "../db/schema.js";
import { buildSourcingRuleJobContent, computeIntervalCron } from "./sourcing-rule-jobs.js";

type Db = ReturnType<typeof getDb>;

// Extracted from create-sourcing-rule.ts so create-prospect-pull-plan.ts can
// create one sourcing rule per persona in a mix without duplicating the
// segment-creation/job-creation/compensating-cleanup logic. create-sourcing-
// rule.ts itself is a thin wrapper around this now -- its own behavior is
// unchanged.
async function cleanupOrphanedSegment(db: Db, segmentId: string): Promise<void> {
  try {
    await db.delete(segmentContacts).where(eq(segmentContacts.segmentId, segmentId));
    await db.delete(segments).where(eq(segments.id, segmentId));
  } catch (cleanupError) {
    console.error(
      `[create-sourcing-rule-core] Failed to clean up orphaned segment ${segmentId} after a later step failed:`,
      cleanupError,
    );
  }
}

export interface CreateSourcingRuleCoreParams {
  name: string;
  ownerEmail: string;
  orgId: string | null | undefined;
  personaId: string;
  subPersonaId?: string | null;
  icpId?: string | null;
  companyAllowList?: string[] | null;
  companyDenyList?: string[] | null;
  manualTitleKeywords?: string[] | null;
  manualSeniorities?: string[] | null;
  minLinkedinFollowers?: number | null;
  previousCompanyName?: string | null;
  desiredVolume: number;
  intervalHours: number;
}

export interface CreateSourcingRuleCoreResult {
  id: string;
  segmentId: string;
  cronExpression: string;
}

export async function createSourcingRuleCore(
  db: Db,
  params: CreateSourcingRuleCoreParams,
): Promise<CreateSourcingRuleCoreResult> {
  const {
    name,
    ownerEmail,
    orgId,
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
  } = params;

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

  const segmentId = nanoid();
  await db.insert(segments).values({
    id: segmentId,
    name: `${name} (sourced)`,
    ownerEmail,
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
    createdBy: ownerEmail,
    ruleId,
    orgId,
  });

  try {
    await resourcePut(ownerEmail, jobResourcePath, jobContent, "text/markdown");
  } catch (err) {
    await cleanupOrphanedSegment(db, segmentId);
    throw err;
  }

  try {
    await db.insert(sourcingRules).values({
      id: ruleId,
      name,
      ownerEmail,
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
      readyByTime: "00:00",
      leadHours: 1,
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
        `[create-sourcing-rule-core] Failed to clean up orphaned job resource ${jobResourcePath} after the rule row insert failed:`,
        cleanupError,
      );
    }
    await cleanupOrphanedSegment(db, segmentId);
    throw err;
  }

  return { id: ruleId, segmentId, cronExpression };
}
