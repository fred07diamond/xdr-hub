import { defineAction } from "@agent-native/core";
import { eq, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { messagingEdges, messagingNodes } from "../server/db/schema.js";

export default defineAction({
  description: "Delete a messaging node and all its connected edges. Cannot delete the global node.",
  schema: z.object({ id: z.string() }),
  requiresAuth: true,
  run: async ({ id }, ctx) => {
    const db = getDb();

    const row = await db
      .select({ type: messagingNodes.type, ownerEmail: messagingNodes.ownerEmail })
      .from(messagingNodes)
      .where(eq(messagingNodes.id, id))
      .limit(1);

    if (!row[0]) return { ok: false, error: "Node not found" };
    if (row[0].type === "global" || row[0].type === "persona") {
      return { ok: false, error: "Cannot delete persona anchor nodes." };
    }
    if (row[0].ownerEmail !== ctx!.userEmail) {
      return { ok: false, error: "Not authorized to delete this node." };
    }

    await Promise.all([
      db.delete(messagingEdges).where(or(eq(messagingEdges.sourceId, id), eq(messagingEdges.targetId, id))),
      db.delete(messagingNodes).where(eq(messagingNodes.id, id)),
    ]);

    return { ok: true };
  },
});
