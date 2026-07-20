import { defineAction } from "@agent-native/core";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { messagingEdges } from "../server/db/schema.js";

type Db = ReturnType<typeof import("../server/db/index.js").getDb>;

// BFS reachability check scoped to a single user's edges.
async function canReach(
  startId: string,
  targetId: string,
  ownerEmail: string,
  db: Db,
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
      .where(and(eq(messagingEdges.sourceId, current), eq(messagingEdges.ownerEmail, ownerEmail)));
    for (const c of children) queue.push(c.targetId);
  }
  return false;
}

export default defineAction({
  description: "Create a directed edge between two messaging nodes. Rejects cycles. Scoped to the current user.",
  schema: z.object({
    sourceId: z.string(),
    targetId: z.string(),
  }),
  requiresAuth: true,
  run: async ({ sourceId, targetId }, ctx) => {
    if (sourceId === targetId) {
      return { ok: false, error: "A node cannot connect to itself." };
    }

    const db = getDb();
    const ownerEmail = ctx!.userEmail!;

    // Prevent duplicate edges for this user
    const dupEdges = await db
      .select({ id: messagingEdges.id, targetId: messagingEdges.targetId })
      .from(messagingEdges)
      .where(and(eq(messagingEdges.sourceId, sourceId), eq(messagingEdges.ownerEmail, ownerEmail)));
    if (dupEdges.some((e) => e.targetId === targetId)) {
      return { ok: false, error: "Edge already exists." };
    }

    // Cycle check within this user's edges
    const wouldCycle = await canReach(targetId, sourceId, ownerEmail, db);
    if (wouldCycle) {
      return { ok: false, error: "This connection would create a cycle." };
    }

    const id = nanoid();
    const now = new Date().toISOString();
    await db.insert(messagingEdges).values({ id, sourceId, targetId, ownerEmail, createdAt: now });

    return { ok: true, id };
  },
});
