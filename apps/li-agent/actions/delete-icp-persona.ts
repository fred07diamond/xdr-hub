import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getSharedDb, sharedPersonaDocs, sharedPersonas } from "@xdr-hub/shared/server";
import { requireAdmin } from "../server/helpers/require-admin.js";

export default defineAction({
  description: "Delete an ICP persona. Cannot delete the active persona.",
  schema: z.object({ id: z.string() }),
  run: async ({ id }, ctx) => {
    await requireAdmin(ctx);
    const sharedDb = getSharedDb();
    const row = await sharedDb
      .select({ isActive: sharedPersonas.isActive })
      .from(sharedPersonas)
      .where(eq(sharedPersonas.id, id))
      .limit(1);

    if (row[0]?.isActive === 1) {
      return { ok: false, error: "Cannot delete the active persona. Set another persona active first." };
    }

    // Cascade the persona's attached ICP documents -- nothing else
    // references sharedPersonaDocs.personaId, so leaving them behind would
    // just orphan rows that no longer feed any persona's criteria text.
    await sharedDb.delete(sharedPersonaDocs).where(eq(sharedPersonaDocs.personaId, id));
    await sharedDb.delete(sharedPersonas).where(eq(sharedPersonas.id, id));
    return { ok: true };
  },
});
