import { defineAction } from "@agent-native/core";
import { completeText, runWithRequestContext } from "@agent-native/core/server";
import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icpPersonas, messagingEdges, messagingNodes } from "../server/db/schema.js";
import { getOwnerCtx } from "../server/helpers/get-owner-ctx.js";
import { ensureUserCanvas } from "../server/helpers/seed-system-canvases.js";

const NODE_SCHEMA = z.array(
  z.object({
    personaName: z.string(),
    type: z.enum(["tone", "phrase_rule", "example", "role"]),
    title: z.string(),
    tone: z.string().optional(),
    valueProps: z.string().optional(),
    phrasesToUse: z.string().optional(),
    phrasesToAvoid: z.string().optional(),
    exampleNotes: z.string().optional(),
    notes: z.string().optional(),
  }),
);

export default defineAction({
  description:
    "Synthesize a messaging canvas from any document. Runs in the background — no chat panel.",
  schema: z.object({
    docText: z.string().min(1),
    canvasId: z.string().optional(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ docText, canvasId }, ctx) => {
    const db = getDb();
    const userEmail = ctx!.userEmail!;

    const activeCanvasId = canvasId ?? (await ensureUserCanvas(userEmail, db));

    const [existingNodes, personas] = await Promise.all([
      db
        .select()
        .from(messagingNodes)
        .where(eq(messagingNodes.canvasId, activeCanvasId))
        .orderBy(asc(messagingNodes.createdAt)),
      db
        .select({ id: icpPersonas.id, name: icpPersonas.name })
        .from(icpPersonas)
        .orderBy(asc(icpPersonas.createdAt)),
    ]);

    const personaNames =
      personas.length > 0
        ? personas.map((p) => p.name).join(", ")
        : "Design Persona, Engineering Persona, Product Persona";

    const existingSummary =
      existingNodes.length > 0
        ? `The canvas already has ${existingNodes.length} nodes covering: ${[...new Set(existingNodes.map((n) => n.type))].join(", ")}. Add new content — do not duplicate what's already there.`
        : "The canvas is empty — build it out fully.";

    const systemPrompt = `You are a B2B messaging strategist. Your job is to synthesize LinkedIn outreach messaging nodes from any input document — account research, product docs, org charts, strategy decks, anything. Always produce useful messaging output.

Return a JSON array. Each element is one canvas node. Schema per element:
{
  "personaName": string,   // which persona this node targets (use one of the personas listed)
  "type": "tone" | "phrase_rule" | "example" | "role",
  "title": string,         // short descriptive title
  "tone": string,          // for tone nodes: voice and style guidance
  "valueProps": string,    // for tone nodes: key value propositions
  "phrasesToUse": string,  // for phrase_rule nodes
  "phrasesToAvoid": string,// for phrase_rule nodes
  "exampleNotes": string,  // for example nodes: sample connection note text
  "notes": string          // any node: extra context
}

Rules:
- Always create at least one node per persona.
- Infer messaging from whatever the document contains. If it's account research, infer pain points and angles. If it's a product doc, extract value props and phrases. If it's an org chart, infer role-specific angles.
- Do not refuse. Every document has something useful for messaging.
- Output raw JSON array only — no markdown, no explanation.`;

    const input = `Target personas: ${personaNames}

${existingSummary}

Document:
${docText.slice(0, 8000)}`;

    const ownerCtx = await getOwnerCtx();
    const call = () => completeText({ systemPrompt, input, maxOutputTokens: 2000 });
    const result = ownerCtx ? await runWithRequestContext(ownerCtx, call) : await call();

    let nodes: z.infer<typeof NODE_SCHEMA>;
    try {
      const raw = result.text.trim().replace(/^```json\n?/, "").replace(/\n?```$/, "");
      nodes = NODE_SCHEMA.parse(JSON.parse(raw));
    } catch {
      return { nodesCreated: 0, error: "Could not parse model output as JSON" };
    }

    // Build persona id map
    const personaMap = new Map(personas.map((p) => [p.name.toLowerCase(), p.id]));

    const now = new Date().toISOString();
    let col = 0;

    for (const node of nodes) {
      const personaId =
        personaMap.get(node.personaName.toLowerCase()) ??
        personaMap.values().next().value ??
        null;

      // Find the persona anchor node to wire the edge to
      const anchorNode = existingNodes.find(
        (n) => n.type === "persona" && n.personaId === personaId,
      );

      const nodeId = nanoid();
      const x = 300 + (col % 4) * 280;
      const y = 200 + Math.floor(col / 4) * 200;
      col++;

      await db.insert(messagingNodes).values({
        id: nodeId,
        type: node.type,
        title: node.title,
        ownerEmail: userEmail,
        canvasId: activeCanvasId,
        personaId: personaId ?? null,
        tone: node.tone ?? null,
        valueProps: node.valueProps ?? null,
        phrasesToUse: node.phrasesToUse ?? null,
        phrasesToAvoid: node.phrasesToAvoid ?? null,
        exampleNotes: node.exampleNotes ?? null,
        notes: node.notes ?? null,
        positionX: x,
        positionY: y,
        createdAt: now,
        updatedAt: now,
      });

      if (anchorNode) {
        await db.insert(messagingEdges).values({
          id: nanoid(),
          sourceId: anchorNode.id,
          targetId: nodeId,
          ownerEmail: userEmail,
          canvasId: activeCanvasId,
          createdAt: now,
        });
      }
    }

    return { nodesCreated: nodes.length };
  },
});
