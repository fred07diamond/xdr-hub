import { defineAction } from "@agent-native/core";
import { desc, eq, inArray, sql } from "@agent-native/core/db/schema";
import { getSharedDb, sharedPersonas } from "@xdr-hub/shared/server";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icps, segmentContacts, sourcingRules, subPersonas } from "../server/db/schema.js";
import { getUserRole, requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "List sourcing rules owned by the caller, plus every rule if the caller is an admin — with persona/sub-persona names and the owned segment's current contact count.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_input, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();
    const role = await getUserRole(ctx!.userEmail!);

    const whereClause = role === "admin" ? undefined : eq(sourcingRules.ownerEmail, ctx!.userEmail!);

    const rows = await db
      .select({
        id: sourcingRules.id,
        name: sourcingRules.name,
        ownerEmail: sourcingRules.ownerEmail,
        personaId: sourcingRules.personaId,
        subPersonaId: sourcingRules.subPersonaId,
        icpId: sourcingRules.icpId,
        companyAllowList: sourcingRules.companyAllowList,
        companyDenyList: sourcingRules.companyDenyList,
        companyAllowListOwnerId: sourcingRules.companyAllowListOwnerId,
        companyDenyListOwnerId: sourcingRules.companyDenyListOwnerId,
        manualTitleKeywords: sourcingRules.manualTitleKeywords,
        manualSeniorities: sourcingRules.manualSeniorities,
        minLinkedinFollowers: sourcingRules.minLinkedinFollowers,
        previousCompanyName: sourcingRules.previousCompanyName,
        desiredVolume: sourcingRules.desiredVolume,
        readyByTime: sourcingRules.readyByTime,
        leadHours: sourcingRules.leadHours,
        intervalHours: sourcingRules.intervalHours,
        segmentId: sourcingRules.segmentId,
        jobResourcePath: sourcingRules.jobResourcePath,
        status: sourcingRules.status,
        createdAt: sourcingRules.createdAt,
        subPersonaName: subPersonas.name,
        icpName: icps.name,
      })
      .from(sourcingRules)
      .leftJoin(subPersonas, eq(sourcingRules.subPersonaId, subPersonas.id))
      .leftJoin(icps, eq(sourcingRules.icpId, icps.id))
      .where(whereClause)
      .orderBy(desc(sourcingRules.createdAt));

    if (rows.length === 0) return { rules: [] };

    const counts = await db
      .select({ segmentId: segmentContacts.segmentId, count: sql<number>`count(*)` })
      .from(segmentContacts)
      .where(inArray(segmentContacts.segmentId, rows.map((r) => r.segmentId)))
      .groupBy(segmentContacts.segmentId);
    const countMap = new Map(counts.map((c) => [c.segmentId, Number(c.count)]));

    // Personas live in the shared cross-app DB now -- separate query + Map
    // merge, same idiom as list-personas.ts's own sub-persona/library-doc
    // counts.
    const personaIds = [...new Set(rows.map((r) => r.personaId).filter((id): id is string => !!id))];
    const personaRows = personaIds.length
      ? await getSharedDb().select({ id: sharedPersonas.id, name: sharedPersonas.name }).from(sharedPersonas).where(inArray(sharedPersonas.id, personaIds))
      : [];
    const personaNameById = new Map(personaRows.map((p) => [p.id, p.name]));

    return {
      rules: rows.map((r) => ({
        ...r,
        personaName: r.personaId ? (personaNameById.get(r.personaId) ?? null) : null,
        contactCount: countMap.get(r.segmentId) ?? 0,
      })),
    };
  },
});
