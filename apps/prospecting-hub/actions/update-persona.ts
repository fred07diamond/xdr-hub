import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { addPersonaDoc, getSharedDb, sharedPersonaDocs, sharedPersonas } from "@xdr-hub/shared/server";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { personas } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Update a core persona's name, color, description, document text (replacing its entire document set with one new document), or its linked li-agent persona (for LinkedIn-leg pool pulls in prospect pull plans).",
  schema: z.object({
    id: z.string().min(1),
    name: z.string().nullish(),
    color: z.string().nullish(),
    description: z.string().nullish(),
    text: z.string().nullish().describe("New document text — REPLACES this persona's entire document set with a single new document"),
    liAgentPersonaId: z
      .string()
      .nullish()
      .describe("Id of the matching persona in li-agent's icpPersonas table, or null to unlink"),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ id, name, color, description, text, liAgentPersonaId }, ctx) => {
    await requireRole(ctx?.userEmail, ["admin"]);
    const db = getDb();
    const sharedDb = getSharedDb();

    const existing = await sharedDb.select({ id: sharedPersonas.id }).from(sharedPersonas).where(eq(sharedPersonas.id, id)).limit(1);
    if (!existing[0]) {
      throw Object.assign(new Error(`Persona ${id} not found.`), { statusCode: 404 });
    }

    if (name || color || (description !== undefined && description !== null)) {
      await sharedDb
        .update(sharedPersonas)
        .set({
          ...(name ? { name } : {}),
          ...(color ? { color } : {}),
          ...(description !== undefined && description !== null ? { description } : {}),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(sharedPersonas.id, id));
    }

    // `text` REPLACES this persona's entire document set with one new
    // document — mirrors the old destructive-replace semantics of the
    // `criteria` column, just against the doc table now.
    if (text) {
      await sharedDb.delete(sharedPersonaDocs).where(eq(sharedPersonaDocs.personaId, id));
      await addPersonaDoc(sharedDb, { personaId: id, fileName: "Original upload", content: text });
    }

    // liAgentPersonaId is a Phase 5 bridge field that still lives on the OLD
    // local `personas` table — out of scope for this migration, untouched.
    if (liAgentPersonaId !== undefined) {
      await db.update(personas).set({ liAgentPersonaId: liAgentPersonaId ?? null }).where(eq(personas.id, id));
    }

    return { id };
  },
});
