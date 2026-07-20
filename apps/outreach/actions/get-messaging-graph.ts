import { defineAction } from "@agent-native/core";
import { asc, eq, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icpPersonas, messagingEdges, messagingNodes } from "../server/db/schema.js";

export default defineAction({
  description: "Return the full messaging graph (nodes + edges) and the list of ICP personas. Auto-syncs persona canvas nodes from ICP personas.",
  schema: z.object({}),
  http: { method: "GET" },
  requiresAuth: true,
  run: async () => {
    const db = getDb();

    const [nodes, edges, personas] = await Promise.all([
      db.select().from(messagingNodes).orderBy(asc(messagingNodes.createdAt)),
      db.select().from(messagingEdges).orderBy(asc(messagingEdges.createdAt)),
      db
        .select({ id: icpPersonas.id, name: icpPersonas.name, color: icpPersonas.color })
        .from(icpPersonas)
        .orderBy(asc(icpPersonas.createdAt)),
    ]);

    const personaIds = new Set(personas.map((p) => p.id));
    const existingPersonaNodes = nodes.filter((n) => n.type === "persona");
    const coveredPersonaIds = new Set(
      existingPersonaNodes.map((n) => n.personaId).filter(Boolean) as string[],
    );

    // Filter out legacy global nodes — personas are now the canvas roots
    let finalNodes = nodes.filter((n) => n.type !== "global");

    const now = new Date().toISOString();

    // Remove orphaned persona canvas nodes whose ICP persona was deleted
    for (const n of existingPersonaNodes) {
      if (n.personaId && !personaIds.has(n.personaId)) {
        await db.delete(messagingEdges).where(
          or(eq(messagingEdges.sourceId, n.id), eq(messagingEdges.targetId, n.id)),
        );
        await db.delete(messagingNodes).where(eq(messagingNodes.id, n.id));
        finalNodes = finalNodes.filter((node) => node.id !== n.id);
      }
    }

    // Sync persona canvas node titles when ICP persona was renamed
    for (const n of existingPersonaNodes) {
      const persona = personas.find((p) => p.id === n.personaId);
      if (persona && n.title !== persona.name) {
        await db
          .update(messagingNodes)
          .set({ title: persona.name, updatedAt: now })
          .where(eq(messagingNodes.id, n.id));
        const idx = finalNodes.findIndex((fn) => fn.id === n.id);
        if (idx !== -1) finalNodes[idx] = { ...finalNodes[idx], title: persona.name };
      }
    }

    // Auto-create persona canvas nodes for ICP personas that don't have one yet
    const validPersonaNodeCount = existingPersonaNodes.filter(
      (n) => n.personaId && personaIds.has(n.personaId),
    ).length;
    let positionOffset = validPersonaNodeCount;

    for (const persona of personas) {
      if (!coveredPersonaIds.has(persona.id)) {
        const id = nanoid();
        const posY = 100 + positionOffset * 350;
        await db.insert(messagingNodes).values({
          id,
          type: "persona",
          title: persona.name,
          personaId: persona.id,
          positionX: 100,
          positionY: posY,
          createdAt: now,
          updatedAt: now,
        });
        finalNodes.push({
          id,
          type: "persona",
          title: persona.name,
          personaId: persona.id,
          tone: null,
          valueProps: null,
          phrasesToUse: null,
          phrasesToAvoid: null,
          exampleNotes: null,
          notes: null,
          positionX: 100,
          positionY: posY,
          createdAt: now,
          updatedAt: now,
        });
        positionOffset++;
      }
    }

    return { nodes: finalNodes, edges, personas };
  },
});
