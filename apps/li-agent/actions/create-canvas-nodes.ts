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
  // Batch-local id this node can be referenced by (e.g. "role-1"). Must
  // appear on a node listed BEFORE any node that points to it via parentRef —
  // the batch is processed in array order.
  ref: z.string().optional(),
  // Points at another node's `ref` earlier in this same batch, nesting this
  // node under it (e.g. a named champion under the role they hold). Takes
  // priority over personaName/company wiring when it resolves.
  parentRef: z.string().optional(),
  personaName: z.string().optional(),
  tone: z.string().nullable().optional(),
  valueProps: z.string().nullable().optional(),
  phrasesToUse: z.string().nullable().optional(),
  phrasesToAvoid: z.string().nullable().optional(),
  exampleNotes: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export default defineAction({
  description:
    "Bulk-create typed canvas nodes from extracted document intelligence, wiring a proper tree: " +
    "company -> persona (matched by personaName) -> role -> named individual (via parentRef). " +
    "Pass nodes in parent-before-child order. Any node that can't resolve a persona or parentRef " +
    "falls back to wiring straight to the company anchor rather than being left disconnected. " +
    "Use after reading a document attachment to build the messaging canvas.",
  schema: z.object({
    canvasId: z.string().optional(),
    nodes: z.array(NODE_INPUT).min(1).max(40),
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

    // Company comes first — becomes the account anchor for edge wiring.
    // Stable sort: only company is reordered, everything else keeps the
    // caller's parent-before-child order.
    const sorted = [...nodes].sort((a, b) =>
      a.type === "company" && b.type !== "company" ? -1 :
      b.type === "company" && a.type !== "company" ? 1 : 0
    );

    let accountAnchorId: string | null = null;
    const createdIds: string[] = [];
    const refToNodeId = new Map<string, string>();
    const nonCompanyCount = sorted.filter((n) => n.type !== "company").length;
    const companyY = 200 + (nonCompanyCount * 110) / 2;

    // Each distinct parent ("company", "persona:<id>", "ref:<parentRef>") gets
    // its own vertical band, assigned the first time it's seen, so siblings
    // under different parents stack independently instead of colliding —
    // this is what makes deeper nesting actually read as a tree rather than
    // an overlapping pile.
    const laneBaseline = new Map<string, number>();
    const yCursorByLane = new Map<string, number>();
    let laneCount = 0;
    function yFor(parentKey: string): number {
      if (!laneBaseline.has(parentKey)) {
        laneBaseline.set(parentKey, 40 + laneCount * 260);
        laneCount++;
      }
      const cur = yCursorByLane.get(parentKey) ?? laneBaseline.get(parentKey)!;
      yCursorByLane.set(parentKey, cur + 130);
      return cur;
    }

    for (const node of sorted) {
      const isPersonaAffiliated = PERSONA_AFFILIATED.has(node.type);
      const personaId = isPersonaAffiliated && node.personaName
        ? (personaMap.get(node.personaName.toLowerCase()) ?? null)
        : null;
      const personaAnchorNode = personaId !== null
        ? existingNodes.find((n) => n.type === "persona" && n.personaId === personaId)
        : null;

      // Parent resolution priority: explicit parentRef (a node earlier in
      // THIS batch) > matched persona anchor > company anchor. A node is
      // never left with zero edges as long as a company node exists.
      const parentRefNodeId = node.parentRef ? refToNodeId.get(node.parentRef) ?? null : null;
      const resolvedParentId = parentRefNodeId ?? personaAnchorNode?.id ?? null;
      const wireToCompanyFallback = resolvedParentId === null && node.type !== "company";
      const edgeParentId = resolvedParentId ?? (wireToCompanyFallback ? accountAnchorId : null);

      const nodeId = nanoid();
      let x: number;
      let y: number;

      if (node.type === "company") {
        x = 200;
        y = companyY;
      } else if (parentRefNodeId) {
        // True nested child (e.g. a named person under their role) — second ring.
        x = 840;
        y = yFor(`ref:${node.parentRef}`);
      } else if (personaAnchorNode) {
        // First ring, grouped under whichever persona anchor it matched.
        x = 520;
        y = yFor(`persona:${personaAnchorNode.id}`);
      } else {
        // First ring, no persona match — falls back to the company lane.
        x = 520;
        y = yFor("company");
      }

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
      if (node.ref) refToNodeId.set(node.ref, nodeId);
      if (node.type === "company" && !accountAnchorId) accountAnchorId = nodeId;

      if (edgeParentId) {
        await db.insert(messagingEdges).values({
          id: nanoid(), sourceId: edgeParentId, targetId: nodeId,
          ownerEmail: userEmail, canvasId: activeCanvasId, createdAt: now,
        });
      }
    }

    return { nodesCreated: createdIds.length, nodeIds: createdIds };
  },
});
