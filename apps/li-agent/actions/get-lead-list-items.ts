import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadLists, leadListItems } from "../server/db/schema.js";

export default defineAction({
  description: "Get the leads in a Sales Navigator lead list.",
  schema: z.object({ listId: z.string() }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ listId }, ctx) => {
    const db = getDb();
    const listRows = await db
      .select()
      .from(leadLists)
      .where(eq(leadLists.id, listId));
    const list = listRows[0];
    if (!list || list.ownerEmail !== ctx!.userEmail) throw new Error("List not found");
    const items = await db
      .select()
      .from(leadListItems)
      .where(eq(leadListItems.listId, listId))
      .orderBy(leadListItems.position);
    return { list, items };
  },
});
