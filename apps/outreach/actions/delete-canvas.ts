// apps/outreach/actions/delete-canvas.ts
import { defineAction } from "@agent-native/core";
import { eq, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { messagingCanvases, messagingEdges, messagingNodes } from "../server/db/schema.js";

export default defineAction({
  description: "Delete a user-owned messaging canvas and all its nodes and edges.",
  schema: z.object({ id: z.string() }),
  requiresAuth: true,
  run: async ({ id }, ctx) => {
    const db = getDb();
    const ownerEmail = ctx!.userEmail!;

    const row = await db
      .select({ isSystem: messagingCanvases.isSystem, ownerEmail: messagingCanvases.ownerEmail })
      .from(messagingCanvases)
      .where(eq(messagingCanvases.id, id))
      .limit(1);

    if (!row[0]) return { ok: false, error: "Canvas not found." };
    if (row[0].isSystem) return { ok: false, error: "System canvases cannot be deleted." };
    if (row[0].ownerEmail !== ownerEmail) return { ok: false, error: "Not authorized." };

    // Collect node IDs to clean up edges
    const nodeIds = (
      await db
        .select({ id: messagingNodes.id })
        .from(messagingNodes)
        .where(eq(messagingNodes.canvasId, id))
    ).map((n) => n.id);

    // Delete edges, nodes, canvas
    if (nodeIds.length > 0) {
      for (const nodeId of nodeIds) {
        await db
          .delete(messagingEdges)
          .where(or(eq(messagingEdges.sourceId, nodeId), eq(messagingEdges.targetId, nodeId)));
      }
      await db.delete(messagingNodes).where(eq(messagingNodes.canvasId, id));
    }
    await db.delete(messagingCanvases).where(eq(messagingCanvases.id, id));

    return { ok: true };
  },
});
