import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { messagingEdges } from "../server/db/schema.js";

// BFS reachability check: returns true if `startId` can reach `targetId` via edges.
async function canReach(
  startId: string,
  targetId: string,
  db: ReturnType<typeof import("../server/db/index.js").getDb>,
): Promise<boolean> {
  const visited = new Set<string>();
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === targetId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const children = await db
      .select({ targetId: messagingEdges.targetId })
      .from(messagingEdges)
      .where(eq(messagingEdges.sourceId, current));
    for (const c of children) queue.push(c.targetId);
  }
  return false;
}

export default defineAction({
  description: "Create a directed edge between two messaging nodes. Rejects cycles.",
  schema: z.object({
    sourceId: z.string(),
    targetId: z.string(),
  }),
  requiresAuth: true,
  run: async ({ sourceId, targetId }) => {
    if (sourceId === targetId) {
      return { ok: false, error: "A node cannot connect to itself." };
    }

    const db = getDb();

    // Prevent duplicate edges
    const dupEdges = await db
      .select({ id: messagingEdges.id, targetId: messagingEdges.targetId })
      .from(messagingEdges)
      .where(eq(messagingEdges.sourceId, sourceId));
    if (dupEdges.some((e) => e.targetId === targetId)) {
      return { ok: false, error: "Edge already exists." };
    }

    // Cycle check: would adding source→target create a cycle?
    // A cycle exists if targetId can already reach sourceId.
    const wouldCycle = await canReach(targetId, sourceId, db);
    if (wouldCycle) {
      return { ok: false, error: "This connection would create a cycle." };
    }

    const id = nanoid();
    const now = new Date().toISOString();
    await db.insert(messagingEdges).values({ id, sourceId, targetId, createdAt: now });

    return { ok: true, id };
  },
});
