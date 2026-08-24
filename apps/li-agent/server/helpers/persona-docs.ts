import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../db/index.js";
import { icpPersonaDocs, icpPersonas } from "../db/schema.js";

type Db = ReturnType<typeof getDb>;

/** Hard cap per uploaded document, so one pasted-in monster can't blow up
 *  every downstream prompt (draft-profile/score-engager already slice
 *  icpText to 3000 chars, but the raw row still gets read and concatenated
 *  on every capture). Applied at the action boundary, not here. */
export const MAX_DOC_CHARS = 200_000;

/** Cap on how many docs one persona can hold. */
export const MAX_DOCS_PER_PERSONA = 25;

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * The persona "summary" is what selectPersona/selectPersonasBatch show the
 * matching LLM (sliced to 300 chars) to pick a persona for a profile, so it
 * has to describe the persona, not whichever doc happens to sort last. It
 * stays the first paragraph of the FIRST document -- same behaviour as the
 * old single-doc personas.
 */
export function extractSummary(text: string): string {
  const first = text.split(/\n\n/)[0]?.trim() ?? "";
  return first.length > 220 ? first.slice(0, 217) + "…" : first;
}

/**
 * Recompute icpPersonas.icpText / summary from that persona's documents.
 *
 * Each doc is prefixed with its filename as a markdown heading so the model
 * can tell where one document stops and the next starts -- without it, two
 * concatenated docs read as one contradictory document.
 *
 * A persona with zero docs gets icpText: null, which is load-bearing:
 * selectPersona filters on `isNotNull(icpPersonas.icpText)`, so an emptied
 * persona correctly drops out of matching rather than matching on "".
 */
export async function rebuildPersonaIcpText(
  db: Db,
  personaId: string,
): Promise<{ icpText: string | null; docCount: number; wordCount: number }> {
  const docs = await db
    .select({
      name: icpPersonaDocs.name,
      text: icpPersonaDocs.text,
      wordCount: icpPersonaDocs.wordCount,
    })
    .from(icpPersonaDocs)
    .where(eq(icpPersonaDocs.personaId, personaId))
    .orderBy(asc(icpPersonaDocs.sortOrder), asc(icpPersonaDocs.createdAt));

  const icpText = docs.length
    ? docs.map((d) => `## ${d.name}\n\n${d.text.trim()}`).join("\n\n---\n\n")
    : null;

  await db
    .update(icpPersonas)
    .set({
      icpText,
      summary: docs.length ? extractSummary(docs[0].text) : null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(icpPersonas.id, personaId));

  return {
    icpText,
    docCount: docs.length,
    wordCount: docs.reduce((sum, d) => sum + d.wordCount, 0),
  };
}

/**
 * Next sortOrder for a persona -- max(existing) + 1, so an added batch lands
 * after everything already attached instead of interleaving with it.
 */
export async function nextSortOrder(db: Db, personaId: string): Promise<number> {
  const rows = await db
    .select({ sortOrder: icpPersonaDocs.sortOrder })
    .from(icpPersonaDocs)
    .where(eq(icpPersonaDocs.personaId, personaId));
  return rows.reduce((max, r) => Math.max(max, r.sortOrder), -1) + 1;
}

/**
 * One-time, self-healing backfill for personas created BEFORE multi-document
 * support: those rows have icpPersonas.icpText set but zero icpPersonaDocs
 * rows. Without adopting that text as the persona's first document, the very
 * first call to rebuildPersonaIcpText() would rebuild icpText from an empty
 * docs table and silently destroy the ICP the whole app scores against.
 *
 * Idempotent: does nothing once the persona has any document, and nothing for
 * a persona with no legacy text either. Safe to call on every add and on the
 * list read path -- after the first call for a given persona it's a no-op.
 *
 * Returns true if it actually adopted something.
 */
export async function adoptLegacyIcpTextAsDoc(
  db: Db,
  persona: { id: string; name: string; icpText: string | null },
): Promise<boolean> {
  if (!persona.icpText?.trim()) return false;

  const existing = await db
    .select({ id: icpPersonaDocs.id })
    .from(icpPersonaDocs)
    .where(eq(icpPersonaDocs.personaId, persona.id))
    .limit(1);
  if (existing.length > 0) return false;

  await db.insert(icpPersonaDocs).values({
    id: nanoid(),
    personaId: persona.id,
    name: `${persona.name} ICP`,
    text: persona.icpText,
    wordCount: countWords(persona.icpText),
    sortOrder: 0,
    createdAt: new Date().toISOString(),
  });
  return true;
}
