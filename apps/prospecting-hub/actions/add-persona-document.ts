import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { addPersonaDoc, getSharedDb, MAX_DOC_CHARS, MAX_DOCS_PER_PERSONA, sharedPersonaDocs, sharedPersonas } from "@xdr-hub/shared/server";
import { z } from "zod";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "Add a file to a persona's knowledge base. Multiple files combine into the persona's criteria, which every scoring/messaging path reads.",
  schema: z.object({
    personaId: z.string().min(1),
    fileName: z.string().min(1),
    text: z.string().min(1),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ personaId, fileName, text }, ctx) => {
    await requireRole(ctx?.userEmail, ["admin"]);
    const sharedDb = getSharedDb();

    const existing = await sharedDb.select({ id: sharedPersonas.id }).from(sharedPersonas).where(eq(sharedPersonas.id, personaId)).limit(1);
    if (!existing[0]) {
      throw Object.assign(new Error(`Persona ${personaId} not found.`), { statusCode: 404 });
    }

    // Criteria is always doc-derived under the new shared-persona model (no
    // more single-criteria-column legacy state to self-heal) -- just enforce
    // the same caps li-agent's add-persona-documents.ts enforces before
    // inserting.
    const currentDocs = await sharedDb
      .select({ id: sharedPersonaDocs.id })
      .from(sharedPersonaDocs)
      .where(eq(sharedPersonaDocs.personaId, personaId));
    if (currentDocs.length + 1 > MAX_DOCS_PER_PERSONA) {
      throw Object.assign(
        new Error(`A persona can hold at most ${MAX_DOCS_PER_PERSONA} documents (${currentDocs.length} already attached).`),
        { statusCode: 400 },
      );
    }
    if (text.length > MAX_DOC_CHARS) {
      throw Object.assign(new Error(`"${fileName}" is too large (limit ${MAX_DOC_CHARS.toLocaleString()} characters).`), {
        statusCode: 400,
      });
    }

    const result = await addPersonaDoc(sharedDb, { personaId, fileName, content: text });

    return { personaId, docCount: result.docCount, wordCount: result.wordCount };
  },
});
