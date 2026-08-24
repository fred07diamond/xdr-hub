import { defineAction } from "@agent-native/core";
import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getSharedDb, sharedPersonas } from "@xdr-hub/shared/server";
import { getDb } from "../server/db/index.js";
import { messagingEdges, messagingNodes } from "../server/db/schema.js";
import { ensureUserCanvas } from "../server/helpers/seed-system-canvases.js";
import { assertCanvasWritable } from "../server/helpers/canvas-access.js";

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

const ROW_H = 130;
const LANE_GAP = 100;

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
    if (canvasId) await assertCanvasWritable(canvasId, userEmail, db);
    const activeCanvasId = canvasId ?? (await ensureUserCanvas(userEmail, db));

    const sharedDb = getSharedDb();
    const [existingNodes, personas] = await Promise.all([
      db.select().from(messagingNodes)
        .where(eq(messagingNodes.canvasId, activeCanvasId))
        .orderBy(asc(messagingNodes.createdAt)),
      sharedDb.select({ id: sharedPersonas.id, name: sharedPersonas.name })
        .from(sharedPersonas)
        .orderBy(asc(sharedPersonas.createdAt)),
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

    // ── Pass 1: resolve each node's lane key WITHOUT touching the DB ──────────
    // parentRef only needs another node's `ref` string (known up front) and
    // persona-anchor matching only needs existingNodes/personaMap (already
    // fetched) — neither depends on the ids we're about to create. Resolving
    // lane keys first lets us size each lane by its REAL child count instead
    // of assuming every lane is the same size, which is what caused a role
    // with 14 people and a role with 3 to overlap into one solid column.
    const laneKeyByIndex: (string | null)[] = sorted.map((node) => {
      if (node.type === "company") return null;
      if (node.parentRef) return `ref:${node.parentRef}`;
      if (PERSONA_AFFILIATED.has(node.type) && node.personaName) {
        const personaId = personaMap.get(node.personaName.toLowerCase()) ?? null;
        const anchor = personaId !== null
          ? existingNodes.find((n) => n.type === "persona" && n.personaId === personaId)
          : null;
        if (anchor) return `persona:${anchor.id}`;
      }
      return "company";
    });

    const laneOrder: string[] = [];
    const laneCounts = new Map<string, number>();
    for (const key of laneKeyByIndex) {
      if (!key) continue;
      if (!laneCounts.has(key)) laneOrder.push(key);
      laneCounts.set(key, (laneCounts.get(key) ?? 0) + 1);
    }

    // Stack lanes vertically, each sized to its own child count — no two
    // lanes' rows can ever overlap regardless of how unevenly sized they are.
    const laneBaseline = new Map<string, number>();
    let cursor = 40;
    for (const key of laneOrder) {
      laneBaseline.set(key, cursor);
      cursor += laneCounts.get(key)! * ROW_H + LANE_GAP;
    }
    const yCursorByLane = new Map<string, number>();
    function yFor(key: string): number {
      const cur = yCursorByLane.get(key) ?? laneBaseline.get(key)!;
      yCursorByLane.set(key, cur + ROW_H);
      return cur;
    }

    // ── Pass 2: actually create rows + edges, using the precomputed lanes ────
    let accountAnchorId: string | null = null;
    const createdIds: string[] = [];
    const refToNodeId = new Map<string, string>();
    const companyY = 200 + (cursor / 2);

    for (let i = 0; i < sorted.length; i++) {
      const node = sorted[i];
      const laneKey = laneKeyByIndex[i];
      const isPersonaAffiliated = PERSONA_AFFILIATED.has(node.type);
      const personaId = isPersonaAffiliated && node.personaName
        ? (personaMap.get(node.personaName.toLowerCase()) ?? null)
        : null;

      const parentRefNodeId = node.parentRef ? refToNodeId.get(node.parentRef) ?? null : null;
      const personaAnchorId = laneKey?.startsWith("persona:") ? laneKey.slice("persona:".length) : null;
      const resolvedParentId = parentRefNodeId ?? personaAnchorId ?? null;
      const wireToCompanyFallback = resolvedParentId === null && node.type !== "company";
      const edgeParentId = resolvedParentId ?? (wireToCompanyFallback ? accountAnchorId : null);

      const nodeId = nanoid();
      let x: number;
      let y: number;
      if (node.type === "company") {
        x = 200;
        y = companyY;
      } else if (parentRefNodeId) {
        x = 840; // true nested child — second ring
        y = yFor(laneKey!);
      } else {
        x = 520; // first ring — persona-matched or company fallback
        y = yFor(laneKey!);
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
