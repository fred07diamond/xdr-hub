import { defineAction } from "@agent-native/core";
import { asc, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icpPersonaDocs, icpPersonas } from "../server/db/schema.js";
import { adoptLegacyIcpTextAsDoc } from "../server/helpers/persona-docs.js";
import { resolveOwnerStrict } from "../server/helpers/resolve-owner.js";

export default defineAction({
  description:
    "List all ICP personas ordered by creation date, each with the ICP documents attached to it (names and word counts, not the document text).",
  schema: z.object({
    apiToken: z.string().nullish().describe("Personal API token — extension callers only"),
  }),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: true, requiresAuth: false },
  http: { method: "GET" },
  readOnly: true,
  run: async ({ apiToken }, ctx) => {
    // Persona names and ICP word counts are org data -- a credential-free
    // caller gets nothing, same rule as list-lead-lists-for-extension.
    // Reading is open to any workspace member (the ICP tab is read-only for
    // non-admins); only the write actions add an admin gate on top.
    const email = await resolveOwnerStrict(apiToken, ctx);
    if (!email) return { personas: [] };

    const db = getDb();
    const rows = await db
      .select({
        id: icpPersonas.id,
        name: icpPersonas.name,
        color: icpPersonas.color,
        icpText: icpPersonas.icpText,
        summary: icpPersonas.summary,
        isActive: icpPersonas.isActive,
        createdAt: icpPersonas.createdAt,
        updatedAt: icpPersonas.updatedAt,
      })
      .from(icpPersonas)
      .orderBy(asc(icpPersonas.createdAt));

    if (rows.length === 0) return { personas: [] };

    let docs = await db
      .select({
        id: icpPersonaDocs.id,
        personaId: icpPersonaDocs.personaId,
        name: icpPersonaDocs.name,
        wordCount: icpPersonaDocs.wordCount,
        sortOrder: icpPersonaDocs.sortOrder,
        createdAt: icpPersonaDocs.createdAt,
      })
      .from(icpPersonaDocs)
      .where(inArray(icpPersonaDocs.personaId, rows.map((r) => r.id)))
      .orderBy(asc(icpPersonaDocs.sortOrder), asc(icpPersonaDocs.createdAt));

    // Self-heal personas created before multi-document support: their ICP
    // lives in icpPersonas.icpText with no doc row to show in the UI. Adopt
    // it as document #1 so the list renders (and can be added to) uniformly.
    // A one-time event per persona -- after the first call this loop finds
    // nothing to do and performs no writes.
    const withDocs = new Set(docs.map((d) => d.personaId));
    const legacy = rows.filter((r) => !withDocs.has(r.id) && r.icpText?.trim());
    if (legacy.length > 0) {
      let adoptedAny = false;
      for (const persona of legacy) {
        if (await adoptLegacyIcpTextAsDoc(db, persona)) adoptedAny = true;
      }
      if (adoptedAny) {
        docs = await db
          .select({
            id: icpPersonaDocs.id,
            personaId: icpPersonaDocs.personaId,
            name: icpPersonaDocs.name,
            wordCount: icpPersonaDocs.wordCount,
            sortOrder: icpPersonaDocs.sortOrder,
            createdAt: icpPersonaDocs.createdAt,
          })
          .from(icpPersonaDocs)
          .where(inArray(icpPersonaDocs.personaId, rows.map((r) => r.id)))
          .orderBy(asc(icpPersonaDocs.sortOrder), asc(icpPersonaDocs.createdAt));
      }
    }

    const docsByPersona = new Map<string, typeof docs>();
    for (const doc of docs) {
      const list = docsByPersona.get(doc.personaId) ?? [];
      list.push(doc);
      docsByPersona.set(doc.personaId, list);
    }

    return {
      personas: rows.map((r) => {
        const documents = docsByPersona.get(r.id) ?? [];
        return {
          id: r.id,
          name: r.name,
          color: r.color,
          summary: r.summary,
          isActive: r.isActive,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          documents: documents.map((d) => ({
            id: d.id,
            name: d.name,
            wordCount: d.wordCount,
          })),
          docCount: documents.length,
          // Total across every attached document -- what the agent actually
          // reads for this persona.
          wordCount: documents.reduce((sum, d) => sum + d.wordCount, 0),
        };
      }),
    };
  },
});
