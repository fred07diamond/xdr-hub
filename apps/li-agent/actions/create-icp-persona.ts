import { defineAction } from "@agent-native/core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icpPersonaDocs, icpPersonas } from "../server/db/schema.js";
import {
  MAX_DOCS_PER_PERSONA,
  MAX_DOC_CHARS,
  countWords,
  rebuildPersonaIcpText,
} from "../server/helpers/persona-docs.js";
import { requireAdminFromSessionOrToken } from "../server/helpers/require-admin.js";

export default defineAction({
  description:
    "Create a new ICP persona with a name, color, and one or more ICP documents. Pass `documents` for a multi-document persona; the single `icpText` argument is the older one-document form and is still accepted.",
  schema: z.object({
    name: z.string().min(1).max(80),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#6366f1"),
    icpText: z.string().min(1).optional().describe("Single-document form — the full ICP text"),
    documents: z
      .array(
        z.object({
          name: z.string().min(1).max(200).describe("Filename or short label for this document"),
          text: z.string().min(1).describe("Full text content of the document"),
        }),
      )
      .min(1)
      .max(MAX_DOCS_PER_PERSONA)
      .optional()
      .describe("Multi-document form — the documents to attach, in reading order"),
    apiToken: z.string().nullish().describe("Personal API token — extension callers only"),
  }),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: false, requiresAuth: false },
  // ICP documents are plain text and normally a few KB. Reject an oversized
  // batch here with a clear message instead of letting it fail further out at
  // the platform's own request-size limit.
  maxBodyBytes: 4_000_000,
  run: async ({ name, color, icpText, documents, apiToken }, ctx) => {
    await requireAdminFromSessionOrToken(apiToken, ctx);
    const db = getDb();

    // Normalize both input shapes onto the document list -- icpPersonas.icpText
    // is derived from icpPersonaDocs, so even the single-text form is stored
    // as one document rather than written straight to the column. Keeping one
    // storage path means a persona created either way behaves identically
    // when documents are added to it later.
    const docs = documents ?? (icpText ? [{ name: `${name} ICP`, text: icpText }] : []);
    if (docs.length === 0) {
      return { ok: false as const, error: "Provide at least one document (or icpText)." };
    }

    const oversized = docs.find((d) => d.text.length > MAX_DOC_CHARS);
    if (oversized) {
      return {
        ok: false as const,
        error: `"${oversized.name}" is too large (limit ${MAX_DOC_CHARS.toLocaleString()} characters).`,
      };
    }

    const id = nanoid();
    const now = new Date().toISOString();

    await db.insert(icpPersonas).values({
      id,
      name,
      color,
      icpText: null, // set by rebuildPersonaIcpText below
      summary: null,
      isActive: 0,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(icpPersonaDocs).values(
      docs.map((doc, i) => ({
        id: nanoid(),
        personaId: id,
        name: doc.name,
        text: doc.text,
        wordCount: countWords(doc.text),
        sortOrder: i,
        createdAt: now,
      })),
    );

    const rebuilt = await rebuildPersonaIcpText(db, id);

    return {
      ok: true as const,
      id,
      name,
      color,
      docCount: rebuilt.docCount,
      wordCount: rebuilt.wordCount,
    };
  },
});
