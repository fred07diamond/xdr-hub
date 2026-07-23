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

    const systemPrompt = `You are a B2B sales intelligence analyst. Extract entities and insights from any document and map them to canvas node types for LinkedIn outreach.

Node types and when to use each:
- "company": a named company found in the doc. Title = company name. notes = outreach-relevant summary extracted from the doc (industry, size, pain points, business context, anything useful). Populate notes generously from what the doc says.
- "role": a specific job title or function. Title = the role. notes = what this role cares about and how to message them. phrasesToUse = phrases that resonate. phrasesToAvoid = phrases that turn them off.
- "identify_pain": a problem, challenge, or pain point mentioned. Title = short pain label. notes = full description from the doc.
- "metrics": business outcomes or KPIs mentioned. Title = short metric label. notes = context on what success looks like.
- "economic_buyer": a person or role with budget authority. Title = person/role name. notes = what you know about them.
- "decision_criteria": requirements the buyer evaluates. Title = short label. notes = the criteria.
- "decision_process": how the buying decision is made. Title = short label. notes = the process steps.
- "paper_process": legal or procurement steps. Title = short label. notes = what's required.
- "champion": an internal advocate or key influencer. Title = person/role name. notes = their position and interests.
- "competition": a competing product or approach mentioned. Title = competitor name. notes = context and differentiation angles.
- "tone": voice and style guidance found in the doc. Title = short label. tone = the voice. valueProps = key value propositions.
- "phrase_rule": specific language rules from the doc. Title = short label. phrasesToUse = exact phrases to use. phrasesToAvoid = exact phrases to avoid.
- "example": sample outreach copy found in the doc. Title = short label. exampleNotes = the example text.

Rules:
- Extract every meaningful entity. A good doc should yield 3-10 nodes.
- For company nodes: extract everything useful from the doc into notes — don't make things up, but be thorough with what's there.
- Set personaName only for tone/phrase_rule/example/role nodes when a specific persona is clearly implied. Leave it empty otherwise.
- Do not refuse. Every document has useful signal.
- Output raw JSON array only — no markdown, no explanation.`;

    const input = `Available personas: ${personaNames}

${existingSummary}

Document to analyze:
${docText.slice(0, 10000)}

Extract entities and create canvas nodes. Focus on what's actually in the document.`;

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

    const PERSONA_AFFILIATED = new Set(["tone", "phrase_rule", "example", "role"]);

    const personaMap = new Map(personas.map((p) => [p.name.toLowerCase(), p.id]));
    const now = new Date().toISOString();
    let col = 0;

    for (const node of nodes) {
      const isPersonaAffiliated = PERSONA_AFFILIATED.has(node.type);

      const personaId = isPersonaAffiliated && node.personaName
        ? (personaMap.get(node.personaName.toLowerCase()) ?? personaMap.values().next().value ?? null)
        : null;

      const anchorNode = isPersonaAffiliated
        ? existingNodes.find((n) => n.type === "persona" && n.personaId === personaId)
        : null;

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
