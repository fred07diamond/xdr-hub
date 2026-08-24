import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  MAX_DOCS_PER_PERSONA,
  MAX_DOC_CHARS,
  countWords,
  getSharedDb,
  nextSortOrder,
  rebuildPersonaCriteriaText,
  sharedPersonaDocs,
  sharedPersonas,
} from "@xdr-hub/shared/server";
import { requireAdminFromSessionOrToken } from "../server/helpers/require-admin.js";

// Adds documents to a persona WITHOUT replacing what's already attached --
// this is the multi-document path. update-icp-persona's icpText argument is
// still the single-doc replace path and is what the legacy "Replace doc"
// flow used; prefer this action for anything user-facing.
export default defineAction({
  description:
    "Attach one or more ICP documents to an existing persona, in addition to any documents already attached. Use this when the user uploads or pastes persona criteria documents. The persona's combined ICP text is rebuilt from all of its documents afterward, and that combined text is what scores every captured profile.",
  schema: z.object({
    personaId: z.string().describe("id of the persona to attach the documents to"),
    documents: z
      .array(
        z.object({
          name: z.string().min(1).max(200).describe("Filename or short label for this document"),
          text: z.string().min(1).describe("Full text content of the document"),
        }),
      )
      .min(1)
      .max(MAX_DOCS_PER_PERSONA)
      .describe("Documents to attach, in the order they should be read"),
    apiToken: z.string().nullish().describe("Personal API token — extension callers only"),
  }),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: false, requiresAuth: false },
  // ICP documents are plain text and normally a few KB. Reject an oversized
  // batch here with a clear message instead of letting it fail further out at
  // the platform's own request-size limit.
  maxBodyBytes: 4_000_000,
  run: async ({ personaId, documents, apiToken }, ctx) => {
    await requireAdminFromSessionOrToken(apiToken, ctx);
    const sharedDb = getSharedDb();

    const persona = await sharedDb
      .select({ id: sharedPersonas.id, name: sharedPersonas.name })
      .from(sharedPersonas)
      .where(eq(sharedPersonas.id, personaId))
      .limit(1);
    if (!persona[0]) return { ok: false as const, error: "Persona not found." };

    const existing = await sharedDb
      .select({ id: sharedPersonaDocs.id })
      .from(sharedPersonaDocs)
      .where(eq(sharedPersonaDocs.personaId, personaId));
    if (existing.length + documents.length > MAX_DOCS_PER_PERSONA) {
      return {
        ok: false as const,
        error: `A persona can hold at most ${MAX_DOCS_PER_PERSONA} documents (${existing.length} already attached).`,
      };
    }

    const oversized = documents.find((d) => d.text.length > MAX_DOC_CHARS);
    if (oversized) {
      return {
        ok: false as const,
        error: `"${oversized.name}" is too large (limit ${MAX_DOC_CHARS.toLocaleString()} characters).`,
      };
    }

    const startOrder = await nextSortOrder(sharedDb, personaId);
    const now = new Date().toISOString();
    const added = documents.map((doc, i) => ({
      id: nanoid(),
      personaId,
      fileName: doc.name,
      content: doc.text,
      wordCount: countWords(doc.text),
      sortOrder: startOrder + i,
      createdAt: now,
    }));

    await sharedDb.insert(sharedPersonaDocs).values(added);
    const rebuilt = await rebuildPersonaCriteriaText(sharedDb, personaId);

    return {
      ok: true as const,
      personaId,
      personaName: persona[0].name,
      added: added.map((d) => ({ id: d.id, name: d.fileName, wordCount: d.wordCount })),
      docCount: rebuilt.docCount,
      wordCount: rebuilt.wordCount,
    };
  },
});
