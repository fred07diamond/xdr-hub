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
    type: z.enum([
      "tone", "phrase_rule", "example", "role",
      "company", "metrics", "economic_buyer",
      "decision_criteria", "decision_process", "paper_process",
      "identify_pain", "champion", "competition",
    ]),
    title: z.string(),
    personaName: z.string().optional(),  // only for persona-affiliated types
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

    const systemPrompt = `OUTPUT FORMAT: Respond with a raw JSON array only. Start with [ and end with ]. No markdown, no explanation, no preamble. If nothing qualifies, return [].

You are a B2B sales intelligence analyst. Extract outreach intelligence from documents and map to canvas nodes. Each node feeds into how LinkedIn connection notes are drafted.

WHEN TO CREATE EACH NODE TYPE (only create when the doc gives real, specific signal):

- "company": Named company in doc. Use for personalizing "I saw [company] is..." openings. title=company name. notes=industry, size, initiatives, pain, context — everything useful from the doc.
- "identify_pain": Specific pain that creates outreach urgency. title=pain in 4-6 words. notes=pain + why it matters for cold outreach.
- "champion": Named person or role who'd advocate internally. title=person/role name. notes=position, interests, how to open with them.
- "economic_buyer": Person/role who controls budget. title=role or name. notes=what they care about, how decisions are framed.
- "competition": Competitor or current vendor mentioned. title=competitor name. notes=relationship to account, differentiation angles.
- "decision_criteria": Specific evaluation criteria (not generic "ROI"). title=short label. notes=the criteria.
- "decision_process": Real intel on approval steps or committees. title=short label. notes=the process.
- "paper_process": Compliance, procurement, or security requirements. title=short label. notes=what's required.
- "metrics": Specific KPIs or success metrics. title=metric name. notes=context and what good looks like.
- "role": Messaging guidance for a job function. title=role title. notes=what they care about. phrasesToUse=language that lands. phrasesToAvoid=language to avoid.
- "tone": Communication style guidance. title=short label. tone=the voice. valueProps=key value props.
- "phrase_rule": Specific language dos/don'ts. title=short label. phrasesToUse=exact phrases. phrasesToAvoid=exact phrases.
- "example": Sample outreach copy from the doc. title=short label. exampleNotes=the example text.

SCHEMA for each node: { type, title, personaName?, tone?, valueProps?, phrasesToUse?, phrasesToAvoid?, exampleNotes?, notes? }
Only set personaName for tone/phrase_rule/example/role when a specific persona is clearly implied.
Never fabricate — only use what the document actually says.`;

    const input = `Available personas: ${personaNames}

${existingSummary}

Document to analyze:
${docText.slice(0, 5000)}

Extract entities and create canvas nodes. Focus on what's actually in the document.`;

    const ownerCtx = await getOwnerCtx();
    const call = () => completeText({ systemPrompt, input, maxOutputTokens: 1500 });
    const result = ownerCtx ? await runWithRequestContext(ownerCtx, call) : await call();

    let nodes: z.infer<typeof NODE_SCHEMA>;
    try {
      // Extract the first JSON array from the response, tolerating preamble/postamble text
      const text = result.text.trim();
      const arrayStart = text.indexOf("[");
      const arrayEnd = text.lastIndexOf("]");
      if (arrayStart === -1 || arrayEnd === -1 || arrayEnd < arrayStart) {
        return { nodesCreated: 0, error: `No JSON array in model response. Raw output (first 300 chars): ${text.slice(0, 300)}` };
      }
      const raw = text.slice(arrayStart, arrayEnd + 1);
      nodes = NODE_SCHEMA.parse(JSON.parse(raw));
    } catch (err) {
      return { nodesCreated: 0, error: `Could not parse model output: ${err instanceof Error ? err.message : String(err)}` };
    }

    const PERSONA_AFFILIATED = new Set(["tone", "phrase_rule", "example", "role"]);

    const personaMap = new Map(personas.map((p) => [p.name.toLowerCase(), p.id]));
    const now = new Date().toISOString();

    // Sort so company comes first — it becomes the account anchor for all other entity nodes
    const sortedNodes = [...nodes].sort((a, b) => {
      if (a.type === "company" && b.type !== "company") return -1;
      if (b.type === "company" && a.type !== "company") return 1;
      return 0;
    });

    // Pass 1: insert all nodes; track company anchor and entity node IDs for wiring
    let accountAnchorId: string | null = null;
    const entityNodeIds: string[] = [];

    for (let i = 0; i < sortedNodes.length; i++) {
      const node = sortedNodes[i];
      const isPersonaAffiliated = PERSONA_AFFILIATED.has(node.type);

      const personaId = isPersonaAffiliated && node.personaName
        ? (personaMap.get(node.personaName.toLowerCase()) ?? personaMap.values().next().value ?? null)
        : null;

      const anchorNode = isPersonaAffiliated
        ? existingNodes.find((n) => n.type === "persona" && n.personaId === personaId)
        : null;

      const nodeId = nanoid();

      // Company at left; entity children fan out to the right in a column
      const x = node.type === "company" ? 200 : 520;
      const entityIndex = node.type === "company" ? 0 : entityNodeIds.length;
      const y = node.type === "company"
        ? 200 + (sortedNodes.filter(n => n.type !== "company").length * 110) / 2
        : 80 + entityIndex * 220;

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

      if (node.type === "company" && !accountAnchorId) {
        accountAnchorId = nodeId;
      } else if (!isPersonaAffiliated) {
        entityNodeIds.push(nodeId);
      }

      // Wire persona-affiliated nodes to their persona anchor
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

    // Pass 2: wire entity nodes to the company anchor
    if (accountAnchorId) {
      for (const entityId of entityNodeIds) {
        await db.insert(messagingEdges).values({
          id: nanoid(),
          sourceId: accountAnchorId,
          targetId: entityId,
          ownerEmail: userEmail,
          canvasId: activeCanvasId,
          createdAt: now,
        });
      }
    }

    return { nodesCreated: nodes.length };
  },
});
