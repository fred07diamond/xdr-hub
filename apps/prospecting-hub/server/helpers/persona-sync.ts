import { eq } from "@agent-native/core/db/schema";
import { addPersonaDoc, getSharedDb, sharedPersonaDocs, sharedPersonas } from "@xdr-hub/shared/server";
import { nanoid } from "nanoid";

// Criteria is stored as JSON wrapping the raw doc text rather than a
// deterministically-parsed structure — the AI scoring step (sync-hubspot's
// sibling scoring action) grounds itself in this text directly via
// completeText(), the same way select-persona.ts in li-agent works from raw
// profile text instead of a brittle hand-parsed schema.
//
// NOTE: core personas (personas/personaDocuments) migrated to the shared
// sharedPersonas/sharedPersonaDocs tables (packages/shared) — that table has
// no single `criteria` column at all, so encode/decodePersonaCriteria are no
// longer used for core personas. They're still the encoding icps.criteria
// and subPersonas.criteria use (both stay in this app's own local schema),
// so they remain here for those two callers.
export function encodePersonaCriteria(rawText: string): string {
  return JSON.stringify({ rawText });
}

// Extracts the raw text back out of an encoded criteria value, for UI
// display (word count, preview) and for feeding step 6's scoring prompt.
export function decodePersonaCriteria(criteria: string | null): string | null {
  if (!criteria) return null;
  try {
    const parsed = JSON.parse(criteria) as { rawText?: string };
    return parsed.rawText ?? null;
  } catch {
    return null;
  }
}

// Replaces the old upsertPersonaFromDoc (which upserted into the local
// `personas` table). Core personas now live in the shared sharedPersonas/
// sharedPersonaDocs tables, which have no single `criteria` column at all --
// re-syncing the same sourceDocUrl REPLACES that persona's entire document
// set with one new document (same destructive-replace semantics the old
// column-based version had), matching update-persona.ts's own `text`
// replace behavior. A new sourceDocUrl with no existing match requires a
// name and creates a new sharedPersonas row + its first document. Core
// personas are manager-owned (schema.ts), so callers must already have
// required admin role.
export async function upsertSharedPersonaFromDoc(options: {
  sourceDocUrl: string;
  rawText: string;
  ownerEmail: string;
  name?: string;
  description?: string;
}): Promise<{ personaId: string; created: boolean }> {
  const sharedDb = getSharedDb();

  const existing = await sharedDb
    .select({ id: sharedPersonas.id })
    .from(sharedPersonas)
    .where(eq(sharedPersonas.sourceDocUrl, options.sourceDocUrl))
    .limit(1);

  if (existing[0]) {
    const personaId = existing[0].id;
    if (options.name || options.description) {
      await sharedDb
        .update(sharedPersonas)
        .set({
          ...(options.name ? { name: options.name } : {}),
          ...(options.description ? { description: options.description } : {}),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(sharedPersonas.id, personaId));
    }
    await sharedDb.delete(sharedPersonaDocs).where(eq(sharedPersonaDocs.personaId, personaId));
    await addPersonaDoc(sharedDb, { personaId, fileName: "Synced document", content: options.rawText });
    return { personaId, created: false };
  }

  if (!options.name) {
    throw new Error("A persona name is required when syncing a doc for the first time.");
  }

  const id = nanoid();
  await sharedDb.insert(sharedPersonas).values({
    id,
    name: options.name,
    description: options.description ?? null,
    sourceDocUrl: options.sourceDocUrl,
    ownerEmail: options.ownerEmail,
    createdAt: new Date().toISOString(),
  });
  await addPersonaDoc(sharedDb, { personaId: id, fileName: "Synced document", content: options.rawText });
  return { personaId: id, created: true };
}
