import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { getSharedDb, rebuildPersonaCriteriaText, sharedPersonaDocs } from "@xdr-hub/shared/server";
import { z } from "zod";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Delete a single file from a persona's knowledge base and recompute the persona's combined criteria.",
  schema: z.object({ id: z.string().min(1) }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ id }, ctx) => {
    await requireRole(ctx?.userEmail, ["admin"]);
    const sharedDb = getSharedDb();

    const existing = await sharedDb
      .select({ id: sharedPersonaDocs.id, personaId: sharedPersonaDocs.personaId })
      .from(sharedPersonaDocs)
      .where(eq(sharedPersonaDocs.id, id))
      .limit(1);
    if (!existing[0]) {
      throw Object.assign(new Error(`Persona document ${id} not found.`), { statusCode: 404 });
    }

    await sharedDb.delete(sharedPersonaDocs).where(eq(sharedPersonaDocs.id, id));
    await rebuildPersonaCriteriaText(sharedDb, existing[0].personaId);

    return { ok: true };
  },
});
