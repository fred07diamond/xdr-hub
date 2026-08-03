import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { personaDocuments } from "../server/db/schema.js";
import { recombinePersonaCriteria } from "../server/helpers/persona-documents.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Delete a single file from a persona's knowledge base and recompute the persona's combined criteria.",
  schema: z.object({ id: z.string().min(1) }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ id }, ctx) => {
    await requireRole(ctx?.userEmail, ["admin"]);
    const db = getDb();

    const existing = await db
      .select({ id: personaDocuments.id, personaId: personaDocuments.personaId })
      .from(personaDocuments)
      .where(eq(personaDocuments.id, id))
      .limit(1);
    if (!existing[0]) {
      throw Object.assign(new Error(`Persona document ${id} not found.`), { statusCode: 404 });
    }

    await db.delete(personaDocuments).where(eq(personaDocuments.id, id));
    await recombinePersonaCriteria(existing[0].personaId, db);

    return { ok: true };
  },
});
