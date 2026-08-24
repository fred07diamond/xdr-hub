import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icpPersonaDocs, icpPersonas } from "../server/db/schema.js";
import { requireAdmin } from "../server/helpers/require-admin.js";

export default defineAction({
  description: "Delete an ICP persona. Cannot delete the active persona.",
  schema: z.object({ id: z.string() }),
  run: async ({ id }, ctx) => {
    await requireAdmin(ctx);
    const db = getDb();
    const row = await db
      .select({ isActive: icpPersonas.isActive })
      .from(icpPersonas)
      .where(eq(icpPersonas.id, id))
      .limit(1);

    if (row[0]?.isActive === 1) {
      return { ok: false, error: "Cannot delete the active persona. Set another persona active first." };
    }

    // Cascade the persona's attached ICP documents -- nothing else
    // references icpPersonaDocs.personaId, so leaving them behind would just
    // orphan rows that no longer feed any persona's icpText.
    await db.delete(icpPersonaDocs).where(eq(icpPersonaDocs.personaId, id));
    await db.delete(icpPersonas).where(eq(icpPersonas.id, id));
    return { ok: true };
  },
});
