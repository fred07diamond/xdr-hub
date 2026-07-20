import { defineAction } from "@agent-native/core";
import { eq, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { messagingEdges, messagingNodes } from "../server/db/schema.js";

export default defineAction({
  description: "Delete a messaging node and all its connected edges. Cannot delete the global node.",
  schema: z.object({ id: z.string() }),
  requiresAuth: true,
  run: async ({ id }) => {
    const db = getDb();

    const row = await db
      .select({ type: messagingNodes.type })
      .from(messagingNodes)
      .where(eq(messagingNodes.id, id))
      .limit(1);

    if (!row[0]) return { ok: false, error: "Node not found" };
    if (row[0].type === "global") return { ok: false, error: "Cannot delete the global baseline node." };

    await db.delete(messagingEdges).where(
      or(eq(messagingEdges.sourceId, id), eq(messagingEdges.targetId, id)),
    );
    await db.delete(messagingNodes).where(eq(messagingNodes.id, id));

    return { ok: true };
  },
});
