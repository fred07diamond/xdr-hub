import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { personaDocuments, personas } from "../server/db/schema.js";
import { recombinePersonaCriteria } from "../server/helpers/persona-documents.js";
import { decodePersonaCriteria } from "../server/helpers/persona-sync.js";
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
    const db = getDb();

    const existing = await db
      .select({ id: personas.id, criteria: personas.criteria })
      .from(personas)
      .where(eq(personas.id, personaId))
      .limit(1);
    if (!existing[0]) {
      throw Object.assign(new Error(`Persona ${personaId} not found.`), { statusCode: 404 });
    }

    // Backward-compat migration: if this persona predates the multi-file
    // feature (legacy criteria already set, but no persona_documents rows
    // yet), surface that legacy content as a synthetic first document so it
    // doesn't silently disappear from the file list going forward.
    const currentDocs = await db
      .select({ id: personaDocuments.id })
      .from(personaDocuments)
      .where(eq(personaDocuments.personaId, personaId))
      .limit(1);
    if (currentDocs.length === 0 && existing[0].criteria) {
      const legacyText = decodePersonaCriteria(existing[0].criteria);
      if (legacyText) {
        await db.insert(personaDocuments).values({
          id: nanoid(),
          personaId,
          fileName: "Original upload",
          content: legacyText,
        });
      }
    }

    const id = nanoid();
    await db.insert(personaDocuments).values({
      id,
      personaId,
      fileName,
      content: text,
    });

    await recombinePersonaCriteria(personaId, db);

    return { id, personaId };
  },
});
