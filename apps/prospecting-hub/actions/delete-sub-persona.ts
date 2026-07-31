import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { contactSubPersonas, subPersonas } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Delete a sub-persona. Only its owner or a manager may delete it. Also clears any contact links to it.",
  schema: z.object({ id: z.string().min(1) }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ id }, ctx) => {
    const role = await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    const existing = await db.select().from(subPersonas).where(eq(subPersonas.id, id)).limit(1);
    if (!existing[0]) {
      return { ok: false, error: `Sub-persona ${id} not found.` };
    }

    if (existing[0].ownerEmail !== ctx!.userEmail! && role !== "admin") {
      return { ok: false, error: "Only the sub-persona owner or a manager can delete this." };
    }

    await db.delete(contactSubPersonas).where(eq(contactSubPersonas.subPersonaId, id));
    await db.delete(subPersonas).where(eq(subPersonas.id, id));

    return { ok: true };
  },
});
