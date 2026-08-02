import { defineAction } from "@agent-native/core";
import { desc, inArray, sql } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icps, libraryDocs } from "../server/db/schema.js";
import { decodePersonaCriteria } from "../server/helpers/persona-sync.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "List ICPs (Ideal Customer Profiles) with name, product, color, a word count derived from their synced document text, and linked Sales Library doc count. ICPs have no sub-entity concept (unlike personas' sub-personas) — that asymmetry is intentional.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_input, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();
    const rows = await db
      .select({
        id: icps.id,
        name: icps.name,
        product: icps.product,
        color: icps.color,
        sourceDocUrl: icps.sourceDocUrl,
        criteria: icps.criteria,
        ownerEmail: icps.ownerEmail,
        createdAt: icps.createdAt,
      })
      .from(icps)
      .orderBy(desc(icps.createdAt));

    if (rows.length === 0) return { icps: [] };

    // Separate grouped-count query + Map merge (same shape list-segments.ts
    // uses for its contact counts) rather than a correlated subquery inline
    // in the main select — see list-personas.ts for why the inline
    // correlated-subquery form silently produces wrong (always-zero)
    // counts with this ORM's `sql` tag.
    const icpIds = rows.map((r) => r.id);
    const libraryDocCounts = await db
      .select({ icpId: libraryDocs.linkedIcpId, count: sql<number>`count(*)` })
      .from(libraryDocs)
      .where(inArray(libraryDocs.linkedIcpId, icpIds))
      .groupBy(libraryDocs.linkedIcpId);
    const libraryDocCountMap = new Map(libraryDocCounts.map((c) => [c.icpId, Number(c.count)]));

    return {
      icps: rows.map((p) => {
        const rawText = decodePersonaCriteria(p.criteria);
        return {
          id: p.id,
          name: p.name,
          product: p.product,
          color: p.color,
          sourceDocUrl: p.sourceDocUrl,
          wordCount: rawText ? rawText.split(/\s+/).filter(Boolean).length : 0,
          ownerEmail: p.ownerEmail,
          createdAt: p.createdAt,
          linkedLibraryDocCount: libraryDocCountMap.get(p.id) ?? 0,
        };
      }),
    };
  },
});
