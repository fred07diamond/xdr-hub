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

    const systemPrompt = `You are a B2B sales intelligence analyst building a LinkedIn outreach intelligence canvas. Read the document and extract actionable outreach intelligence mapped to specific node types. Each node type feeds directly into how connection notes are drafted — only create a node if the doc gives you enough real, specific signal to make it useful.

NODE TYPES — what each does downstream and what makes it worth creating:

"company" — The agent uses company context to personalize the opening line of a connection note ("I saw EY is expanding their AI practice..."). Create one per named account. Title = company name. notes = everything the doc says that is useful for outreach: industry, size, strategic focus, current initiatives, pain, context. Be thorough — this is the anchor for all other account intel.

"identify_pain" — The agent references this pain to create urgency ("I know many [role]s at firms like [company] are dealing with X..."). Only create if the doc names a real, specific pain — not a vague business challenge. Title = the pain in 4-6 words. notes = the pain + why it matters for someone receiving a cold connection request.

"champion" — A named person or specific role who would advocate for you internally. The agent tailors the message to their actual interests. Only create if the doc names a real individual or a role with clear motivations. Title = person name or role. notes = their position, what they care about, and how to open with them.

"economic_buyer" — The person or role who controls budget for what you sell. The agent calibrates the hook toward business outcomes for this audience. Only create if the doc surfaces real signal about who owns budget. Title = role or person name. notes = what they care about, how decisions are framed at this level.

"competition" — A competitor or alternative approach the prospect is likely already using. The agent uses this to avoid landmines and position differentiation. Only create if the doc mentions a real competitor or current vendor. Title = competitor name. notes = their relationship to the account and differentiation angles worth knowing.

"decision_criteria" — The criteria the account uses to evaluate solutions. Helps the agent emphasize the right things. Only create if the doc gives specific evaluation criteria — not generic "they want ROI." Title = short label. notes = the criteria in detail.

"decision_process" — How buying decisions are made. Helps the agent set expectations and frame appropriately. Only create if the doc gives real intel on approval steps, committees, or timelines. Title = short label. notes = the process.

"paper_process" — Legal, procurement, or compliance steps. Only create if the doc specifically mentions compliance reviews, security gates, or procurement requirements. Title = short label. notes = what's required.

"metrics" — KPIs or success metrics the account cares about. The agent frames value in these terms. Only create if the doc names specific metrics — not just "they want efficiency." Title = metric name. notes = context and what success looks like.

"role" — Messaging guidance for a specific job function. Only create if the doc gives real signal about what this function cares about. Title = role title. notes = what they care about. phrasesToUse = language that lands. phrasesToAvoid = language that turns them off.

"tone" — Voice and style for outreach. Only create if the doc gives real signal about communication style. Title = short label. tone = the voice. valueProps = key value propositions to lead with.

"phrase_rule" — Specific language rules. Only create if the doc gives real language do's and don'ts. Title = short label. phrasesToUse = exact phrases. phrasesToAvoid = exact phrases to avoid.

"example" — Sample outreach copy from the doc. Only create if the doc contains real example messaging worth reusing. Title = short label. exampleNotes = the example text.

RULES:
- Quality over quantity. Only create a node when the doc gives specific, actionable signal.
- Never fabricate. Only populate fields from what the document actually says.
- If any named account appears, create a "company" node first — it anchors all other account intel.
- Set personaName only for tone/phrase_rule/example/role nodes if a specific persona is clearly implied.
- Your response MUST be a raw JSON array and nothing else — no markdown, no explanation, no preamble.
- If nothing in the document qualifies, return an empty array: []
- Start your response with [ and end with ]`;

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
        return { nodesCreated: 0, error: "Model did not return a JSON array" };
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
