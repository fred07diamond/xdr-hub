import { defineAction } from "@agent-native/core";
import { and, eq } from "@agent-native/core/db/schema";
import { resourcePut } from "@agent-native/core/resources";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { personas, segments, sourcingRules, subPersonas } from "../server/db/schema.js";
import { buildSourcingRuleJobContent, computeSourcingRuleCron } from "../server/helpers/sourcing-rule-jobs.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "Create a sourcing rule — a per-XDR scheduled configuration for the CommonRoom-Prospector pipeline that targets a persona/sub-persona, applies company filters, and runs on a daily cron computed from the desired ready-by time.",
  schema: z.object({
    name: z.string().min(1),
    personaId: z.string().min(1),
    subPersonaId: z.string().nullish(),
    companyAllowList: z.array(z.string()).nullish(),
    companyDenyList: z.array(z.string()).nullish(),
    desiredVolume: z.number().int().min(1).max(200).default(20),
    readyByTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM 24-hour format"),
    leadHours: z.number().int().min(1).max(12).default(3),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async (
    { name, personaId, subPersonaId, companyAllowList, companyDenyList, desiredVolume, readyByTime, leadHours },
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
    const cronExpression = computeSourcingRuleCron(readyByTime, leadHours);
    const jobResourcePath = `jobs/sourcing-rule-${ruleId}.md`;
    const jobContent = buildSourcingRuleJobContent({
      cron: cronExpression,
      enabled: true,
      createdBy: userEmail,
      ruleId,
    });
    await resourcePut(userEmail, jobResourcePath, jobContent, "text/markdown");

    await db.insert(sourcingRules).values({
      id: ruleId,
      name,
      ownerEmail: userEmail,
      personaId,
      subPersonaId: subPersonaId ?? null,
      companyAllowList: companyAllowList ? JSON.stringify(companyAllowList) : null,
      companyDenyList: companyDenyList ? JSON.stringify(companyDenyList) : null,
      desiredVolume,
      readyByTime,
      leadHours,
      segmentId,
      jobResourcePath,
      status: "active",
      createdAt: now,
    });

    return { id: ruleId, segmentId, cronExpression };
  },
});
