import { eq } from "drizzle-orm";
import type { getDb } from "../db/index.js";
import { messagingNodes } from "../db/schema.js";

type Db = ReturnType<typeof getDb>;
type DbNode = typeof messagingNodes.$inferSelect;

function hasContent(n: DbNode): boolean {
  return !!(n.tone || n.valueProps || n.phrasesToUse || n.phrasesToAvoid || n.exampleNotes || n.notes);
}

export async function buildCanvasContext(
  canvasId: string,
  db: Db,
): Promise<string | null> {
  const nodes = await db
    .select()
    .from(messagingNodes)
    .where(eq(messagingNodes.canvasId, canvasId));

  if (nodes.length === 0 || !nodes.some(hasContent)) return null;

  const lines: string[] = ["MESSAGING GUIDELINES — apply when drafting the connection note:"];

  for (const n of nodes) {
    if (!hasContent(n)) continue;
    const t = n.type;

    if (t === "persona" || t === "role") {
      lines.push(`\n[${t === "persona" ? `Persona: ${n.title}` : `Role: ${n.title}`}]`);
      if (n.tone) lines.push(`Tone/Voice: ${n.tone}`);
      if (n.valueProps) lines.push(`Key value props: ${n.valueProps}`);
      if (n.phrasesToUse) lines.push(`Always use: ${n.phrasesToUse}`);
      if (n.phrasesToAvoid) lines.push(`Never say: ${n.phrasesToAvoid}`);
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
    } else if (t === "company") {
      lines.push(`\n[Company Context: ${n.title}]`);
      if (n.notes) lines.push(n.notes);
    } else if (t === "hubspot_reference") {
      lines.push(`\n[Real Example: ${n.title}]`);
      if (n.notes) lines.push(n.notes);
      if (n.exampleNotes) lines.push(`Why this worked:\n${n.exampleNotes}`);
    }
  }

  if (lines.length === 1) return null;
  return lines.join("\n").trim();
}
