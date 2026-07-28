import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { messagingEdges } from "../server/db/schema.js";

export default defineAction({
  description: "Delete a messaging edge by its id. Only the owner may delete their own edges.",
  schema: z.object({ id: z.string() }),
  requiresAuth: true,
  run: async ({ id }, ctx) => {
    const db = getDb();

    const row = await db
      .select({ ownerEmail: messagingEdges.ownerEmail })
      .from(messagingEdges)
      .where(eq(messagingEdges.id, id))
      .limit(1);

    if (!row[0]) return { ok: false, error: "Edge not found." };
    if (row[0].ownerEmail !== ctx!.userEmail) {
      return { ok: false, error: "Not authorized to delete this edge." };
    }

    await db.delete(messagingEdges).where(eq(messagingEdges.id, id));
    return { ok: true };
  },
});
