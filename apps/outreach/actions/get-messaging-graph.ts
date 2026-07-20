import { defineAction } from "@agent-native/core";
import { asc, eq, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icpPersonas, messagingEdges, messagingNodes } from "../server/db/schema.js";

export default defineAction({
  description: "Return the messaging graph for the current user. Persona anchors are shared; all other nodes and edges are per-user.",
  schema: z.object({}),
  http: { method: "GET" },
  requiresAuth: true,
  run: async (_args, ctx) => {
    const db = getDb();
    const userEmail = ctx!.userEmail!;

    const [allNodes, allEdges, personas] = await Promise.all([
      db.select().from(messagingNodes).orderBy(asc(messagingNodes.createdAt)),
      db.select().from(messagingEdges).orderBy(asc(messagingEdges.createdAt)),
      db
        .select({ id: icpPersonas.id, name: icpPersonas.name, color: icpPersonas.color, icpText: icpPersonas.icpText })
        .from(icpPersonas)
        .orderBy(asc(icpPersonas.createdAt)),
    ]);

    const personaIds = new Set(personas.map((p) => p.id));

    // Persona nodes are shared; fine-tuning nodes are scoped to this user
    const existingPersonaNodes = allNodes.filter((n) => n.type === "persona");
    const coveredPersonaIds = new Set(
      existingPersonaNodes.map((n) => n.personaId).filter(Boolean) as string[],
    );

    // Start with persona nodes + this user's own nodes; drop legacy global nodes
    let finalNodes = allNodes.filter(
      (n) => n.type === "persona" || (n.type !== "global" && n.ownerEmail === userEmail),
    );

    // User's own edges only
    const finalEdges = allEdges.filter((e) => e.ownerEmail === userEmail);

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
    const newPersonaNodeIds: string[] = [];

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
          ownerEmail: null,
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
        if (persona.icpText) newPersonaNodeIds.push(id);
        positionOffset++;
      }
    }

    return { nodes: finalNodes, edges: finalEdges, personas, newPersonaNodeIds };
  },
});
