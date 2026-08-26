import { defineAction } from "@agent-native/core";
import { desc, inArray, sql } from "@agent-native/core/db/schema";
import { getPersonaCriteriaText, getSharedDb, sharedLibraryDocs, sharedPersonas } from "@xdr-hub/shared/server";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { personas, subPersonas } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "List core personas with name, color, description, a word count derived from their synced document text, sub-persona count, and linked Sales Library doc count.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_input, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();
    const sharedDb = getSharedDb();
    const rows = await sharedDb
      .select({
        id: sharedPersonas.id,
        name: sharedPersonas.name,
        color: sharedPersonas.color,
        description: sharedPersonas.description,
        sourceDocUrl: sharedPersonas.sourceDocUrl,
        ownerEmail: sharedPersonas.ownerEmail,
        createdAt: sharedPersonas.createdAt,
        titleIncludeKeywords: sharedPersonas.titleIncludeKeywords,
        titleExcludeKeywords: sharedPersonas.titleExcludeKeywords,
        orgIncludeList: sharedPersonas.orgIncludeList,
        orgExcludeList: sharedPersonas.orgExcludeList,
      })
      .from(sharedPersonas)
      .orderBy(desc(sharedPersonas.createdAt));

    if (rows.length === 0) return { personas: [] };

    // liAgentPersonaId is a Phase 5 bridge field that still lives on the OLD
    // local `personas` table (keyed by its own local id, not the shared
    // persona id) -- out of scope for this migration. Looked up separately
    // here purely for display continuity; a shared-only persona (created
    // after this migration) simply has no matching local row and reads null.
    const liAgentPersonaRows = await db.select({ id: personas.id, liAgentPersonaId: personas.liAgentPersonaId }).from(personas);
    const liAgentPersonaIdByPersonaId = new Map(liAgentPersonaRows.map((p) => [p.id, p.liAgentPersonaId]));

    // Two extra grouped-count queries (same "separate query + Map merge"
    // shape list-segments.ts already uses for its contact counts) rather
    // than a correlated subquery inline in the main select — a correlated
    // subquery built via the `sql` tag doesn't table-qualify an
    // interpolated Column reference (it renders bare `"id"`, which inside
    // a subquery resolves to the SUBQUERY's own table, not the outer row),
    // silently producing wrong (always-zero) counts.
    const personaIds = rows.map((r) => r.id);

    const subPersonaCounts = await db
      .select({ personaId: subPersonas.personaId, count: sql<number>`count(*)` })
      .from(subPersonas)
      .where(inArray(subPersonas.personaId, personaIds))
      .groupBy(subPersonas.personaId);
    const subPersonaCountMap = new Map(subPersonaCounts.map((c) => [c.personaId, Number(c.count)]));

    const libraryDocCounts = await sharedDb
      .select({ personaId: sharedLibraryDocs.linkedPersonaId, count: sql<number>`count(*)` })
      .from(sharedLibraryDocs)
      .where(inArray(sharedLibraryDocs.linkedPersonaId, personaIds))
      .groupBy(sharedLibraryDocs.linkedPersonaId);
    const libraryDocCountMap = new Map(libraryDocCounts.map((c) => [c.personaId, Number(c.count)]));

    // No cached criteria column on sharedPersonas -- word count is derived
    // fresh per persona via getPersonaCriteriaText. This means N+1 queries
    // where there used to be 0 extra ones (criteria was inline on the old
    // `personas` row); an accepted tradeoff of the new doc-derived model,
    // not optimized further here.
    const personasWithWordCount = await Promise.all(
      rows.map(async (p) => {
        const { wordCount } = await getPersonaCriteriaText(sharedDb, p.id);
        return {
          id: p.id,
          name: p.name,
          color: p.color,
          description: p.description,
          sourceDocUrl: p.sourceDocUrl,
          wordCount,
          titleIncludeKeywords: p.titleIncludeKeywords,
          titleExcludeKeywords: p.titleExcludeKeywords,
          orgIncludeList: p.orgIncludeList,
          orgExcludeList: p.orgExcludeList,
          liAgentPersonaId: liAgentPersonaIdByPersonaId.get(p.id) ?? null,
          ownerEmail: p.ownerEmail,
          createdAt: p.createdAt,
          subPersonaCount: subPersonaCountMap.get(p.id) ?? 0,
          linkedLibraryDocCount: libraryDocCountMap.get(p.id) ?? 0,
        };
      }),
    );

    return { personas: personasWithWordCount };
  },
});
