import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icpPersonaDocs, icpPersonas } from "../server/db/schema.js";
import {
  MAX_DOCS_PER_PERSONA,
  MAX_DOC_CHARS,
  adoptLegacyIcpTextAsDoc,
  countWords,
  nextSortOrder,
  rebuildPersonaIcpText,
} from "../server/helpers/persona-docs.js";
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
    const db = getDb();

    const persona = await db
      .select({ id: icpPersonas.id, name: icpPersonas.name, icpText: icpPersonas.icpText })
      .from(icpPersonas)
      .where(eq(icpPersonas.id, personaId))
      .limit(1);
    if (!persona[0]) return { ok: false as const, error: "Persona not found." };

    // A persona created before multi-document support has icpText but no doc
    // rows; adopt that text as document #1 FIRST, or the rebuild below would
    // wipe it out. See adoptLegacyIcpTextAsDoc.
    await adoptLegacyIcpTextAsDoc(db, persona[0]);

    const existing = await db
      .select({ id: icpPersonaDocs.id })
      .from(icpPersonaDocs)
      .where(eq(icpPersonaDocs.personaId, personaId));
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

    const startOrder = await nextSortOrder(db, personaId);
    const now = new Date().toISOString();
    const added = documents.map((doc, i) => ({
      id: nanoid(),
      personaId,
      name: doc.name,
      text: doc.text,
      wordCount: countWords(doc.text),
      sortOrder: startOrder + i,
      createdAt: now,
    }));

    await db.insert(icpPersonaDocs).values(added);
    const rebuilt = await rebuildPersonaIcpText(db, personaId);

    return {
      ok: true as const,
      personaId,
      personaName: persona[0].name,
      added: added.map((d) => ({ id: d.id, name: d.name, wordCount: d.wordCount })),
      docCount: rebuilt.docCount,
      wordCount: rebuilt.wordCount,
    };
  },
});
