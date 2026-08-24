import { defineAction } from "@agent-native/core";
import { and, desc, eq, inArray, or, sql } from "@agent-native/core/db/schema";
import { getSharedDb, sharedLibraryDocs, sharedPersonas } from "@xdr-hub/shared/server";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icps } from "../server/db/schema.js";
import { LIBRARY_CATEGORIES } from "../server/helpers/library-tagging.js";
import { requireRole } from "../server/helpers/require-role.js";

const SNIPPET_LENGTH = 200;

export default defineAction({
  description: "List Sales Library documents, filterable by category, linked persona/ICP, and free-text search over name/content.",
  schema: z.object({
    category: z.enum(LIBRARY_CATEGORIES).nullish(),
    search: z.string().nullish().describe("Matches name or content, case-insensitive substring"),
    linkedPersonaId: z.string().nullish(),
    linkedIcpId: z.string().nullish(),
  }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ category, search, linkedPersonaId, linkedIcpId }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const sharedDb = getSharedDb();

    const conditions = [
      category ? eq(sharedLibraryDocs.category, category) : undefined,
      linkedPersonaId ? eq(sharedLibraryDocs.linkedPersonaId, linkedPersonaId) : undefined,
      linkedIcpId ? eq(sharedLibraryDocs.linkedIcpId, linkedIcpId) : undefined,
      search
        ? or(
            sql`lower(${sharedLibraryDocs.name}) LIKE ${`%${search.toLowerCase()}%`}`,
            sql`lower(${sharedLibraryDocs.content}) LIKE ${`%${search.toLowerCase()}%`}`,
          )
        : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);
    const whereClause = conditions.length ? and(...conditions) : undefined;

    const rows = await sharedDb
      .select({
        id: sharedLibraryDocs.id,
        name: sharedLibraryDocs.name,
        category: sharedLibraryDocs.category,
        tags: sharedLibraryDocs.tags,
        content: sharedLibraryDocs.content,
        linkedPersonaId: sharedLibraryDocs.linkedPersonaId,
        linkedIcpId: sharedLibraryDocs.linkedIcpId,
        ownerEmail: sharedLibraryDocs.ownerEmail,
        createdAt: sharedLibraryDocs.createdAt,
      })
      .from(sharedLibraryDocs)
      .where(whereClause)
      .orderBy(desc(sharedLibraryDocs.createdAt));

    // Personas and ICPs live in different DBs from sharedLibraryDocs now
    // (personas in the shared cross-app DB, icps in this app's own local
    // DB) -- neither can be joined in the same query, so fetch the distinct
    // referenced ids and merge names in application code instead (same
    // "separate query + Map merge" idiom list-personas.ts uses for its own
    // sub-persona/library-doc counts).
    const personaIds = [...new Set(rows.map((r) => r.linkedPersonaId).filter((id): id is string => !!id))];
    const personaRows = personaIds.length
      ? await sharedDb.select({ id: sharedPersonas.id, name: sharedPersonas.name }).from(sharedPersonas).where(inArray(sharedPersonas.id, personaIds))
      : [];
    const personaNameById = new Map(personaRows.map((p) => [p.id, p.name]));

    const icpIds = [...new Set(rows.map((r) => r.linkedIcpId).filter((id): id is string => !!id))];
    const icpRows = icpIds.length
      ? await getDb().select({ id: icps.id, name: icps.name }).from(icps).where(inArray(icps.id, icpIds))
      : [];
    const icpNameById = new Map(icpRows.map((p) => [p.id, p.name]));

    return {
      docs: rows.map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        tags: r.tags ? (JSON.parse(r.tags) as string[]) : [],
        contentSnippet: r.content.length > SNIPPET_LENGTH ? `${r.content.slice(0, SNIPPET_LENGTH)}…` : r.content,
        linkedPersonaId: r.linkedPersonaId,
        linkedPersonaName: r.linkedPersonaId ? (personaNameById.get(r.linkedPersonaId) ?? null) : null,
        linkedIcpId: r.linkedIcpId,
        linkedIcpName: r.linkedIcpId ? (icpNameById.get(r.linkedIcpId) ?? null) : null,
        ownerEmail: r.ownerEmail,
        createdAt: r.createdAt,
      })),
    };
  },
});
