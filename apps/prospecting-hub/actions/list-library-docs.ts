import { defineAction } from "@agent-native/core";
import { and, desc, eq, or, sql } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icps, libraryDocs, personas } from "../server/db/schema.js";
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
    const db = getDb();

    const conditions = [
      category ? eq(libraryDocs.category, category) : undefined,
      linkedPersonaId ? eq(libraryDocs.linkedPersonaId, linkedPersonaId) : undefined,
      linkedIcpId ? eq(libraryDocs.linkedIcpId, linkedIcpId) : undefined,
      search
        ? or(
            sql`lower(${libraryDocs.name}) LIKE ${`%${search.toLowerCase()}%`}`,
            sql`lower(${libraryDocs.content}) LIKE ${`%${search.toLowerCase()}%`}`,
          )
        : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);
    const whereClause = conditions.length ? and(...conditions) : undefined;

    const rows = await db
      .select({
        id: libraryDocs.id,
        name: libraryDocs.name,
        category: libraryDocs.category,
        tags: libraryDocs.tags,
        content: libraryDocs.content,
        linkedPersonaId: libraryDocs.linkedPersonaId,
        linkedPersonaName: personas.name,
        linkedIcpId: libraryDocs.linkedIcpId,
        linkedIcpName: icps.name,
        ownerEmail: libraryDocs.ownerEmail,
        createdAt: libraryDocs.createdAt,
      })
      .from(libraryDocs)
      .leftJoin(personas, eq(libraryDocs.linkedPersonaId, personas.id))
      .leftJoin(icps, eq(libraryDocs.linkedIcpId, icps.id))
      .where(whereClause)
      .orderBy(desc(libraryDocs.createdAt));

    return {
      docs: rows.map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        tags: r.tags ? (JSON.parse(r.tags) as string[]) : [],
        contentSnippet: r.content.length > SNIPPET_LENGTH ? `${r.content.slice(0, SNIPPET_LENGTH)}…` : r.content,
        linkedPersonaId: r.linkedPersonaId,
        linkedPersonaName: r.linkedPersonaName,
        linkedIcpId: r.linkedIcpId,
        linkedIcpName: r.linkedIcpName,
        ownerEmail: r.ownerEmail,
        createdAt: r.createdAt,
      })),
    };
  },
});
