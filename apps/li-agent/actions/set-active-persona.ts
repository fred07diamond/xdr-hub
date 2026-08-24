import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getSharedDb, sharedPersonas } from "@xdr-hub/shared/server";
import { requireAdmin } from "../server/helpers/require-admin.js";

export default defineAction({
  description: "Set one ICP persona as active (used for drafting). Clears the previous active persona.",
  schema: z.object({ id: z.string() }),
  run: async ({ id }, ctx) => {
    await requireAdmin(ctx);
    const sharedDb = getSharedDb();
    const now = new Date().toISOString();
    await sharedDb.update(sharedPersonas).set({ isActive: 0, updatedAt: now });
    await sharedDb.update(sharedPersonas).set({ isActive: 1, updatedAt: now }).where(eq(sharedPersonas.id, id));
    return { ok: true, activeId: id };
  },
});
