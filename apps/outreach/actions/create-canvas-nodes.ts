import { defineAction } from "@agent-native/core";
import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icpPersonas, messagingEdges, messagingNodes } from "../server/db/schema.js";
import { ensureUserCanvas } from "../server/helpers/seed-system-canvases.js";

const NODE_INPUT = z.object({
  type: z.enum([
    "tone", "phrase_rule", "example", "role",
    "company", "metrics", "economic_buyer",
    "decision_criteria", "decision_process", "paper_process",
    "identify_pain", "champion", "competition",
  ]),
  title: z.string().min(1).max(120),
  personaName: z.string().optional(),
  tone: z.string().nullable().optional(),
  valueProps: z.string().nullable().optional(),
  phrasesToUse: z.string().nullable().optional(),
  phrasesToAvoid: z.string().nullable().optional(),
  exampleNotes: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export default defineAction({
  description: "Bulk-create typed canvas nodes from extracted document intelligence. Pass an array of node objects; the action handles layout and wires company→entity edges automatically. Use after reading a document attachment to build the messaging canvas.",
  schema: z.object({
    canvasId: z.string().optional(),
    nodes: z.array(NODE_INPUT).min(1).max(20),
  }),
  requiresAuth: true,
  run: async ({ canvasId, nodes }, ctx) => {
    const db = getDb();
    const userEmail = ctx!.userEmail!;
    const activeCanvasId = canvasId ?? (await ensureUserCanvas(userEmail, db));

    const [existingNodes, personas] = await Promise.all([
      db.select().from(messagingNodes)
        .where(eq(messagingNodes.canvasId, activeCanvasId))
        .orderBy(asc(messagingNodes.createdAt)),
      db.select({ id: icpPersonas.id, name: icpPersonas.name })
        .from(icpPersonas)
        .orderBy(asc(icpPersonas.createdAt)),
    ]);

    const PERSONA_AFFILIATED = new Set(["tone", "phrase_rule", "example", "role"]);
    const personaMap = new Map(personas.map((p) => [p.name.toLowerCase(), p.id]));
    const now = new Date().toISOString();

    // Company comes first — becomes the account anchor for edge wiring
    const sorted = [...nodes].sort((a, b) =>
      a.type === "company" && b.type !== "company" ? -1 :
      b.type === "company" && a.type !== "company" ? 1 : 0
    );

    let accountAnchorId: string | null = null;
    const entityNodeIds: string[] = [];
    const createdIds: string[] = [];
    let allNonCompanyIdx = 0;

    for (const node of sorted) {
      const isPersonaAffiliated = PERSONA_AFFILIATED.has(node.type);
      const personaId = isPersonaAffiliated && node.personaName
        ? (personaMap.get(node.personaName.toLowerCase()) ?? null)
        : null;
      const anchorNode = isPersonaAffiliated && personaId !== null
        ? existingNodes.find((n) => n.type === "persona" && n.personaId === personaId)
        : null;

      const nodeId = nanoid();
      const x = node.type === "company" ? 200 : 520;
      const y = node.type === "company"
        ? 200 + (sorted.filter((n) => n.type !== "company").length * 110) / 2
        : 80 + allNonCompanyIdx * 220;
      if (node.type !== "company") allNonCompanyIdx++;

      await db.insert(messagingNodes).values({
        id: nodeId, type: node.type, title: node.title,
        ownerEmail: userEmail, canvasId: activeCanvasId,
        personaId: personaId ?? null,
        tone: node.tone ?? null, valueProps: node.valueProps ?? null,
        phrasesToUse: node.phrasesToUse ?? null, phrasesToAvoid: node.phrasesToAvoid ?? null,
        exampleNotes: node.exampleNotes ?? null, notes: node.notes ?? null,
        positionX: x, positionY: y, createdAt: now, updatedAt: now,
      });

      createdIds.push(nodeId);
      if (node.type === "company" && !accountAnchorId) accountAnchorId = nodeId;
      else if (!isPersonaAffiliated) entityNodeIds.push(nodeId);

      if (anchorNode) {
        await db.insert(messagingEdges).values({
          id: nanoid(), sourceId: anchorNode.id, targetId: nodeId,
          ownerEmail: userEmail, canvasId: activeCanvasId, createdAt: now,
        });
      }
    }

    // Wire entity nodes to the company anchor
    if (accountAnchorId) {
      for (const entityId of entityNodeIds) {
        await db.insert(messagingEdges).values({
          id: nanoid(), sourceId: accountAnchorId, targetId: entityId,
          ownerEmail: userEmail, canvasId: activeCanvasId, createdAt: now,
        });
      }
    }

    return { nodesCreated: createdIds.length, nodeIds: createdIds };
  },
});
