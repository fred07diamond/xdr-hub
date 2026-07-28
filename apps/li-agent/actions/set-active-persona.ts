import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icpPersonas } from "../server/db/schema.js";
import { requireAdmin } from "../server/helpers/require-admin.js";

export default defineAction({
  description: "Set one ICP persona as active (used for drafting). Clears the previous active persona.",
  schema: z.object({ id: z.string() }),
  run: async ({ id }, ctx) => {
    await requireAdmin(ctx);
    const db = getDb();
    const now = new Date().toISOString();
    await db.update(icpPersonas).set({ isActive: 0, updatedAt: now });
    await db.update(icpPersonas).set({ isActive: 1, updatedAt: now }).where(eq(icpPersonas.id, id));
    return { ok: true, activeId: id };
  },
});
