import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadLists } from "../server/db/schema.js";

export default defineAction({
  description: "Rename a Sales Navigator lead list.",
  schema: z.object({ listId: z.string(), name: z.string().min(1).max(120) }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ listId, name }, ctx) => {
    const db = getDb();
    const rows = await db.select().from(leadLists).where(eq(leadLists.id, listId));
    if (!rows[0] || rows[0].ownerEmail !== ctx!.userEmail) throw new Error("List not found");
    await db
      .update(leadLists)
      .set({ name: name.trim(), updatedAt: new Date().toISOString() })
      .where(eq(leadLists.id, listId));
    return { ok: true };
  },
});
