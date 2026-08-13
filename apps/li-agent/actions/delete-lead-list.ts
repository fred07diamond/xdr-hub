import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadLists, leadListItems } from "../server/db/schema.js";

export default defineAction({
  description: "Delete a Sales Navigator lead list and all its items.",
  schema: z.object({ listId: z.string() }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ listId }, ctx) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(leadLists)
      .where(eq(leadLists.id, listId));
    if (!rows[0] || rows[0].ownerEmail !== ctx!.userEmail) throw new Error("List not found");
    await db.delete(leadListItems).where(eq(leadListItems.listId, listId));
    await db.delete(leadLists).where(eq(leadLists.id, listId));
    return { ok: true };
  },
});
