import { eq, isNull } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { messagingEdges, messagingNodes } from "../db/schema.js";

type Db = ReturnType<typeof getDb>;
type DbNode = typeof messagingNodes.$inferSelect;

// BFS down from the matched persona's canvas node, collecting all fine-tuning nodes.
// Returns a formatted text block (persona→leaves) for injection into the drafting prompt,
// or null if no messaging canvas is configured. Edges are scoped to ownerEmail so each
// user's chain is independent.
export async function buildMessagingContext(
  personaId: string | null,
  ownerEmail: string | null,
  db: Db,
): Promise<string | null> {
  if (!personaId) return null;

  const edgeFilter = ownerEmail ? eq(messagingEdges.ownerEmail, ownerEmail) : isNull(messagingEdges.ownerEmail);
  const [nodes, edges] = await Promise.all([
    db.select().from(messagingNodes),
    db.select().from(messagingEdges).where(edgeFilter),
  ]);

  if (nodes.length === 0) return null;

  const personaNode = nodes.find((n) => n.type === "persona" && n.personaId === personaId) ?? null;
  if (!personaNode) return null;

  const chain: DbNode[] = [];
  const queue: DbNode[] = [personaNode];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    chain.push(current);
    for (const edge of edges.filter((e) => e.sourceId === current.id)) {
      const child = nodes.find((n) => n.id === edge.targetId);
      if (child && !visited.has(child.id)) queue.push(child);
    }
  }

  const hasContent = (n: DbNode) =>
    n.tone || n.valueProps || n.phrasesToUse || n.phrasesToAvoid || n.exampleNotes || n.notes;

  if (!chain.some(hasContent)) return null;

  const lines: string[] = ["MESSAGING GUIDELINES — apply when drafting the connection note:"];
  for (const n of chain) {
    if (!hasContent(n)) continue;
    const t = n.type;
    if (t === "persona" || t === "global") {
      lines.push(`\n[${t === "persona" ? `Persona: ${n.title}` : "Global Baseline"}]`);
      if (n.tone) lines.push(`Tone/Voice: ${n.tone}`);
      if (n.valueProps) lines.push(`Key value props: ${n.valueProps}`);
      if (n.phrasesToUse) lines.push(`Always use: ${n.phrasesToUse}`);
      if (n.phrasesToAvoid) lines.push(`Never say: ${n.phrasesToAvoid}`);
      if (n.exampleNotes) lines.push(`Examples:\n${n.exampleNotes}`);
      if (n.notes) lines.push(n.notes);
    } else if (t === "tone") {
      lines.push(`\n[Tone & Voice${n.title !== "Tone & Voice" ? ` — ${n.title}` : ""}]`);
      if (n.tone) lines.push(n.tone);
      if (n.valueProps) lines.push(`Key value props: ${n.valueProps}`);
    } else if (t === "phrase_rule") {
      lines.push(`\n[Phrase Rule${n.title !== "Phrase Rule" ? ` — ${n.title}` : ""}]`);
      if (n.phrasesToUse) lines.push(`✓ Always use: ${n.phrasesToUse}`);
      if (n.phrasesToAvoid) lines.push(`✗ Never say: ${n.phrasesToAvoid}`);
    } else if (t === "example") {
      lines.push(`\n[Example Note${n.title !== "Example Note" ? ` — ${n.title}` : ""}]`);
      if (n.exampleNotes) lines.push(`Write notes like this:\n${n.exampleNotes}`);
    } else if (t === "role") {
      lines.push(`\n[Role: ${n.title}]`);
      if (n.notes) lines.push(`When messaging someone in this role:\n${n.notes}`);
      if (n.tone) lines.push(`Tone adjustment: ${n.tone}`);
      if (n.phrasesToUse) lines.push(`✓ Prefer: ${n.phrasesToUse}`);
      if (n.phrasesToAvoid) lines.push(`✗ Avoid: ${n.phrasesToAvoid}`);
    }
  }

  return lines.join("\n").trim();
}
