import { defineAction } from "@agent-native/core";
import { and, eq } from "@agent-native/core/db/schema";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { personaDocuments, personas } from "../server/db/schema.js";
import { recombinePersonaCriteria } from "../server/helpers/persona-documents.js";
import { decodePersonaCriteria } from "../server/helpers/persona-sync.js";
import { requireRole } from "../server/helpers/require-role.js";

const LEGACY_DOC_NAME = "Original upload";

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
    //
    // This check-then-insert isn't wrapped in a transaction, so two
    // concurrent add-persona-document calls against the same never-touched
    // persona could both observe zero rows and both insert a synthetic
    // "Original upload" row. That's not reachable through the shipped UI
    // (uploads are sequential there), but is self-healed here regardless:
    // after inserting, re-check for duplicates and collapse down to one.
    // The duplicates are guaranteed byte-identical (both derived from the
    // same pre-race legacy criteria value), so which one survives doesn't
    // matter — only that exactly one does, before recombination runs.
    const currentDocs = await db
      .select({ id: personaDocuments.id })
      .from(personaDocuments)
      .where(eq(personaDocuments.personaId, personaId))
      .limit(1);
    if (currentDocs.length === 0 && existing[0].criteria) {
      const legacyText = decodePersonaCriteria(existing[0].criteria);
      // If criteria is set but doesn't decode to usable text (malformed
      // legacy JSON), there's nothing to migrate — the persona simply won't
      // get a synthetic document, which is an accepted edge case since
      // decodePersonaCriteria already treats it as "no criteria" everywhere
      // else in this app.
      if (legacyText) {
        await db.insert(personaDocuments).values({
          id: nanoid(),
          personaId,
          fileName: LEGACY_DOC_NAME,
          content: legacyText,
        });

        const legacyRows = await db
          .select({ id: personaDocuments.id })
          .from(personaDocuments)
          .where(and(eq(personaDocuments.personaId, personaId), eq(personaDocuments.fileName, LEGACY_DOC_NAME)))
          .orderBy(personaDocuments.id);
        const duplicateIds = legacyRows.slice(1).map((r) => r.id);
        for (const dupId of duplicateIds) {
          await db.delete(personaDocuments).where(eq(personaDocuments.id, dupId));
        }
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
