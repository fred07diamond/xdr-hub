import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadLists, leadListItems } from "../server/db/schema.js";

export default defineAction({
  description: "Update the status of a Sales Navigator lead list item.",
  schema: z.object({
    itemId: z.string(),
    status: z.enum(["pending", "visited", "skipped"]),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ itemId, status }, ctx) => {
    const db = getDb();
    // Verify the item exists and belongs to the requesting user's list
    const itemRows = await db.select().from(leadListItems).where(eq(leadListItems.id, itemId));
    const item = itemRows[0];
    if (!item) throw new Error("Item not found");
    const listRows = await db.select().from(leadLists).where(eq(leadLists.id, item.listId));
    if (!listRows[0] || listRows[0].ownerEmail !== ctx!.userEmail) throw new Error("Not authorized");

    await db
      .update(leadListItems)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(leadListItems.id, itemId));
    return { ok: true };
  },
});
