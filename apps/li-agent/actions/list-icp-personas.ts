import { defineAction } from "@agent-native/core";
import { asc, inArray } from "drizzle-orm";
import { z } from "zod";
import { getPersonaCriteriaText, getSharedDb, sharedPersonaDocs, sharedPersonas } from "@xdr-hub/shared/server";
import { hashIcpText, type PersonaBriefing } from "../server/helpers/persona-briefing.js";
import { resolveOwnerStrict } from "../server/helpers/resolve-owner.js";

export default defineAction({
  description:
    "List all ICP personas ordered by creation date, each with the ICP documents attached to it (names and word counts, not the document text) and its generated briefing, if one exists.",
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

    const sharedDb = getSharedDb();
    const rows = await sharedDb
      .select({
        id: sharedPersonas.id,
        name: sharedPersonas.name,
        color: sharedPersonas.color,
        summary: sharedPersonas.summary,
        briefing: sharedPersonas.briefing,
        briefingGeneratedAt: sharedPersonas.briefingGeneratedAt,
        briefingSourceHash: sharedPersonas.briefingSourceHash,
        isActive: sharedPersonas.isActive,
        createdAt: sharedPersonas.createdAt,
        updatedAt: sharedPersonas.updatedAt,
      })
      .from(sharedPersonas)
      .orderBy(asc(sharedPersonas.createdAt));

    if (rows.length === 0) return { personas: [] };

    const docs = await sharedDb
      .select({
        id: sharedPersonaDocs.id,
        personaId: sharedPersonaDocs.personaId,
        fileName: sharedPersonaDocs.fileName,
        wordCount: sharedPersonaDocs.wordCount,
        sortOrder: sharedPersonaDocs.sortOrder,
        createdAt: sharedPersonaDocs.createdAt,
      })
      .from(sharedPersonaDocs)
      .where(inArray(sharedPersonaDocs.personaId, rows.map((r) => r.id)))
      .orderBy(asc(sharedPersonaDocs.sortOrder), asc(sharedPersonaDocs.createdAt));

    const docsByPersona = new Map<string, typeof docs>();
    for (const doc of docs) {
      const list = docsByPersona.get(doc.personaId) ?? [];
      list.push(doc);
      docsByPersona.set(doc.personaId, list);
    }

    return {
      personas: await Promise.all(
        rows.map(async (r) => {
          const documents = docsByPersona.get(r.id) ?? [];

          // A briefing is a read of the persona's criteria text at a point in
          // time. Comparing the stored fingerprint against the CURRENT text
          // is what lets the UI say "documents changed since this was
          // generated" instead of presenting a stale briefing as though it
          // still described the uploaded criteria.
          let briefing: PersonaBriefing | null = null;
          if (r.briefing) {
            try {
              briefing = JSON.parse(r.briefing) as PersonaBriefing;
            } catch {
              briefing = null; // unreadable row: treat as "not generated yet"
            }
          }

          let briefingStale = false;
          if (briefing !== null) {
            const { text: icpText } = await getPersonaCriteriaText(sharedDb, r.id);
            briefingStale = icpText !== null && r.briefingSourceHash !== hashIcpText(icpText);
          }

          return {
            id: r.id,
            name: r.name,
            color: r.color,
            summary: r.summary,
            briefing,
            briefingGeneratedAt: r.briefingGeneratedAt,
            briefingStale,
            isActive: r.isActive,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            documents: documents.map((d) => ({
              id: d.id,
              name: d.fileName,
              wordCount: d.wordCount,
            })),
            docCount: documents.length,
            // Total across every attached document -- what the agent actually
            // reads for this persona.
            wordCount: documents.reduce((sum, d) => sum + (d.wordCount ?? 0), 0),
          };
        }),
      ),
    };
  },
});
