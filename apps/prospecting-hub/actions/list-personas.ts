import { defineAction } from "@agent-native/core";
import { desc, inArray, sql } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { libraryDocs, personas, subPersonas } from "../server/db/schema.js";
import { decodePersonaCriteria } from "../server/helpers/persona-sync.js";
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
    const rows = await db
      .select({
        id: personas.id,
        name: personas.name,
        color: personas.color,
        description: personas.description,
        sourceDocUrl: personas.sourceDocUrl,
        criteria: personas.criteria,
        liAgentPersonaId: personas.liAgentPersonaId,
        ownerEmail: personas.ownerEmail,
        createdAt: personas.createdAt,
      })
      .from(personas)
      .orderBy(desc(personas.createdAt));

    if (rows.length === 0) return { personas: [] };

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

    const libraryDocCounts = await db
      .select({ personaId: libraryDocs.linkedPersonaId, count: sql<number>`count(*)` })
      .from(libraryDocs)
      .where(inArray(libraryDocs.linkedPersonaId, personaIds))
      .groupBy(libraryDocs.linkedPersonaId);
    const libraryDocCountMap = new Map(libraryDocCounts.map((c) => [c.personaId, Number(c.count)]));

    return {
      personas: rows.map((p) => {
        const rawText = decodePersonaCriteria(p.criteria);
        return {
          id: p.id,
          name: p.name,
          color: p.color,
          description: p.description,
          sourceDocUrl: p.sourceDocUrl,
          wordCount: rawText ? rawText.split(/\s+/).filter(Boolean).length : 0,
          liAgentPersonaId: p.liAgentPersonaId,
          ownerEmail: p.ownerEmail,
          createdAt: p.createdAt,
          subPersonaCount: subPersonaCountMap.get(p.id) ?? 0,
          linkedLibraryDocCount: libraryDocCountMap.get(p.id) ?? 0,
        };
      }),
    };
  },
});
