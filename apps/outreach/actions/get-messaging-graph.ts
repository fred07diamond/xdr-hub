import { defineAction } from "@agent-native/core";
import { asc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icpPersonas, messagingEdges, messagingNodes } from "../server/db/schema.js";
import { requireAdmin } from "../server/helpers/require-admin.js";

export default defineAction({
  description: "Return the full messaging graph (nodes + edges) and the list of ICP personas.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  requiresAuth: true,
  run: async (_args, ctx) => {
    const db = getDb();

    const [nodes, edges, personas] = await Promise.all([
      db.select().from(messagingNodes).orderBy(asc(messagingNodes.createdAt)),
      db.select().from(messagingEdges).orderBy(asc(messagingEdges.createdAt)),
      db
        .select({ id: icpPersonas.id, name: icpPersonas.name, color: icpPersonas.color })
        .from(icpPersonas)
        .orderBy(asc(icpPersonas.createdAt)),
    ]);

    // Auto-create the global node for admins if none exists yet.
    let finalNodes = nodes;
    const hasGlobal = nodes.some((n) => n.type === "global");
    if (!hasGlobal) {
      try {
        await requireAdmin(ctx);
        const now = new Date().toISOString();
        const id = nanoid();
        await db.insert(messagingNodes).values({
          id,
          type: "global",
          title: "Global Baseline",
          positionX: 100,
          positionY: 300,
          createdAt: now,
          updatedAt: now,
        });
        finalNodes = [
          {
            id,
            type: "global",
            title: "Global Baseline",
            personaId: null,
            tone: null,
            valueProps: null,
            phrasesToUse: null,
            phrasesToAvoid: null,
            exampleNotes: null,
            notes: null,
            positionX: 100,
            positionY: 300,
            createdAt: now,
            updatedAt: now,
          },
        ];
      } catch {
        // Non-admin — just return empty graph
      }
    }

    return { nodes: finalNodes, edges, personas };
  },
});
