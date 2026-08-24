import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { getSharedDb, sharedPersonas } from "@xdr-hub/shared/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { subPersonas } from "../server/db/schema.js";
import { encodePersonaCriteria } from "../server/helpers/persona-sync.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Create a sub-persona under a core persona — an XDR/AE's own narrower refinement (e.g. a sub-vertical or company list).",
  schema: z.object({
    personaId: z.string().min(1),
    name: z.string().min(1),
    text: z.string().min(1).describe("The sub-persona's own criteria text"),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ personaId, name, text }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    const existing = await getSharedDb().select({ id: sharedPersonas.id }).from(sharedPersonas).where(eq(sharedPersonas.id, personaId)).limit(1);
    if (!existing[0]) {
      throw Object.assign(new Error(`Persona ${personaId} not found.`), { statusCode: 404 });
    }

    const id = nanoid();
    await db.insert(subPersonas).values({
      id,
      personaId,
      name,
      criteria: encodePersonaCriteria(text),
      ownerEmail: ctx!.userEmail!,
      createdAt: new Date().toISOString(),
    });
    return { id };
  },
});
