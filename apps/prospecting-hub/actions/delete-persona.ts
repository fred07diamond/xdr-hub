import { defineAction } from "@agent-native/core";
import { eq, inArray } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getSharedDb, sharedPersonaDocs, sharedPersonas } from "@xdr-hub/shared/server";
import { getDb } from "../server/db/index.js";
import { contacts, contactSubPersonas, segments, subPersonas } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Delete a core persona. Clears the persona reference on any contacts/segments that pointed to it, and removes its sub-personas.",
  schema: z.object({ id: z.string().min(1) }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ id }, ctx) => {
    await requireRole(ctx?.userEmail, ["admin"]);
    const db = getDb();
    const sharedDb = getSharedDb();

    const existing = await sharedDb.select({ id: sharedPersonas.id }).from(sharedPersonas).where(eq(sharedPersonas.id, id)).limit(1);
    if (!existing[0]) {
      return { ok: false, error: `Persona ${id} not found.` };
    }

    const subs = await db.select({ id: subPersonas.id }).from(subPersonas).where(eq(subPersonas.personaId, id));
    const subIds = subs.map((s) => s.id);
    if (subIds.length) {
      await db.delete(contactSubPersonas).where(inArray(contactSubPersonas.subPersonaId, subIds));
      await db.delete(subPersonas).where(eq(subPersonas.personaId, id));
    }

    await db.update(contacts).set({ personaId: null }).where(eq(contacts.personaId, id));
    await db.update(segments).set({ personaId: null }).where(eq(segments.personaId, id));
    await sharedDb.delete(sharedPersonaDocs).where(eq(sharedPersonaDocs.personaId, id));
    await sharedDb.delete(sharedPersonas).where(eq(sharedPersonas.id, id));

    return { ok: true };
  },
});
