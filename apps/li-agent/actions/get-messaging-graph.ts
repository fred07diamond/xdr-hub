import { defineAction } from "@agent-native/core";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getPersonaCriteriaText, getSharedDb, sharedPersonas } from "@xdr-hub/shared/server";
import { getDb } from "../server/db/index.js";
import { messagingEdges, messagingNodes } from "../server/db/schema.js";
import { ensureUserCanvas, seedSystemCanvases } from "../server/helpers/seed-system-canvases.js";
import { assertCanvasReadable } from "../server/helpers/canvas-access.js";

export default defineAction({
  description: "Return the messaging graph for a canvas. Pass canvasId to scope to a specific canvas; omit it to use the user's default canvas.",
  schema: z.object({
    canvasId: z.string().optional(),
  }),
  http: { method: "GET" },
  requiresAuth: true,
  run: async ({ canvasId }, ctx) => {
    const db = getDb();
    const userEmail = ctx!.userEmail!;

    // Ensure the user has at least one canvas (lazy migration)
    await seedSystemCanvases(db);
    const defaultCanvasId = await ensureUserCanvas(userEmail, db);
    const activeCanvasId = canvasId ?? defaultCanvasId;
    if (canvasId) await assertCanvasReadable(canvasId, userEmail, db);

    const sharedDb = getSharedDb();
    const [allNodes, allEdges, personaRows] = await Promise.all([
      db.select().from(messagingNodes)
        .where(eq(messagingNodes.canvasId, activeCanvasId))
        .orderBy(asc(messagingNodes.createdAt)),
      db.select().from(messagingEdges)
        .where(eq(messagingEdges.canvasId, activeCanvasId))
        .orderBy(asc(messagingEdges.createdAt)),
      sharedDb.select({ id: sharedPersonas.id, name: sharedPersonas.name, color: sharedPersonas.color })
        .from(sharedPersonas)
        .orderBy(asc(sharedPersonas.createdAt)),
    ]);

    const personas = await Promise.all(
      personaRows.map(async (p) => {
        const { text: icpText } = await getPersonaCriteriaText(sharedDb, p.id);
        return { ...p, icpText };
      }),
    );

    return { nodes: allNodes, edges: allEdges, personas, activeCanvasId };
  },
});
