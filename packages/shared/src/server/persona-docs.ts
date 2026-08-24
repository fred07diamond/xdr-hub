import { eq } from "@agent-native/core/db/schema";
import { nanoid } from "nanoid";
import type { getSharedDb } from "./db/index.js";
import { sharedPersonaDocs, sharedPersonas } from "./db/index.js";

type SharedDb = ReturnType<typeof getSharedDb>;

// Single shared replacement for what used to be two independent, slightly
// different implementations: li-agent's server/helpers/persona-docs.ts
// (rebuildPersonaIcpText, plain markdown concatenation) and prospecting-
// hub's server/helpers/persona-documents.ts (recombinePersonaCriteria,
// JSON-{rawText}-wrapped). This adopts li-agent's plain-text format --
// the JSON wrapping in prospecting-hub's version served no purpose beyond
// storage; every real consumer only ever wanted the raw text back out.

export const MAX_DOC_CHARS = 200_000;
export const MAX_DOCS_PER_PERSONA = 25;

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * The persona "summary" is what li-agent's selectPersona/selectPersonasBatch
 * show a matching LLM (sliced further there) to pick a persona for a
 * profile -- it has to describe the persona, not whichever doc happens to
 * sort last. Stays the first paragraph of the FIRST document.
 */
export function extractSummary(text: string): string {
  const first = text.split(/\n\n/)[0]?.trim() ?? "";
  return first.length > 220 ? first.slice(0, 217) + "…" : first;
}

/**
 * Pure read: a shared persona's derived criteria text, computed fresh from
 * its documents every call. Each doc is prefixed with its filename as a
 * markdown heading so the model can tell where one document stops and the
 * next starts. No DB write -- safe to call from hot, read-heavy paths like
 * scoring, which may load many personas per call and must not trigger a
 * write on every read. There is no single "criteria" column on the shared
 * table that both apps agree how to encode, so every consumer computes this
 * on demand rather than reading a cached column.
 */
export async function getPersonaCriteriaText(
  db: SharedDb,
  personaId: string,
): Promise<{ text: string | null; docCount: number; wordCount: number }> {
  const docs = await db
    .select({
      fileName: sharedPersonaDocs.fileName,
      content: sharedPersonaDocs.content,
      wordCount: sharedPersonaDocs.wordCount,
    })
    .from(sharedPersonaDocs)
    .where(eq(sharedPersonaDocs.personaId, personaId))
    // Bare columns (not wrapped in desc()) sort ascending — this package's
    // db/schema re-export only provides `desc`, not `asc` (same convention
    // prospecting-hub's own persona-documents.ts already used).
    .orderBy(sharedPersonaDocs.sortOrder, sharedPersonaDocs.createdAt);

  const text = docs.length
    ? docs.map((d) => `## ${d.fileName}\n\n${d.content.trim()}`).join("\n\n---\n\n")
    : null;

  return {
    text,
    docCount: docs.length,
    wordCount: docs.reduce((sum, d) => sum + (d.wordCount ?? 0), 0),
  };
}

/**
 * Same computation as getPersonaCriteriaText, but also persists the derived
 * `summary` (first paragraph of the first doc) and bumps `updatedAt`. Call
 * this only from doc-mutation actions (add/delete a document) -- never from
 * a read path, since it writes on every call.
 */
export async function rebuildPersonaCriteriaText(
  db: SharedDb,
  personaId: string,
): Promise<{ text: string | null; docCount: number; wordCount: number }> {
  const result = await getPersonaCriteriaText(db, personaId);

  const firstDoc = result.text
    ? await db
        .select({ content: sharedPersonaDocs.content })
        .from(sharedPersonaDocs)
        .where(eq(sharedPersonaDocs.personaId, personaId))
        .orderBy(sharedPersonaDocs.sortOrder, sharedPersonaDocs.createdAt)
        .limit(1)
    : [];

  await db
    .update(sharedPersonas)
    .set({
      summary: firstDoc[0] ? extractSummary(firstDoc[0].content) : null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(sharedPersonas.id, personaId));

  return result;
}

/** Next sortOrder for a persona -- max(existing) + 1. */
export async function nextSortOrder(db: SharedDb, personaId: string): Promise<number> {
  const rows = await db
    .select({ sortOrder: sharedPersonaDocs.sortOrder })
    .from(sharedPersonaDocs)
    .where(eq(sharedPersonaDocs.personaId, personaId));
  return rows.reduce((max, r) => Math.max(max, r.sortOrder), -1) + 1;
}

/** Insert one document and recompute the persona's derived text/summary. */
export async function addPersonaDoc(
  db: SharedDb,
  options: { personaId: string; fileName: string; content: string },
): Promise<{ text: string | null; docCount: number; wordCount: number }> {
  const sortOrder = await nextSortOrder(db, options.personaId);
  await db.insert(sharedPersonaDocs).values({
    id: nanoid(),
    personaId: options.personaId,
    fileName: options.fileName,
    content: options.content,
    wordCount: countWords(options.content),
    sortOrder,
    createdAt: new Date().toISOString(),
  });
  return rebuildPersonaCriteriaText(db, options.personaId);
}
