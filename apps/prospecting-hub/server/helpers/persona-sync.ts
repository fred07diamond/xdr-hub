import { eq } from "@agent-native/core/db/schema";
import { nanoid } from "nanoid";
import { getDb } from "../db/index.js";
import { personas } from "../db/schema.js";

// Criteria is stored as JSON wrapping the raw doc text rather than a
// deterministically-parsed structure — the AI scoring step (sync-hubspot's
// sibling scoring action) grounds itself in this text directly via
// completeText(), the same way select-persona.ts in li-agent works from raw
// profile text instead of a brittle hand-parsed schema.
export function encodePersonaCriteria(rawText: string): string {
  return JSON.stringify({ rawText });
}

// Upserts a core persona keyed by sourceDocUrl: re-syncing the same doc
// updates its criteria in place; a new doc URL creates a new persona. Core
// personas are manager-owned (schema.ts), so callers must already have
// required admin role.
export async function upsertPersonaFromDoc(options: {
  sourceDocUrl: string;
  rawText: string;
  ownerEmail: string;
  name?: string;
  description?: string;
}): Promise<{ personaId: string; created: boolean }> {
  const db = getDb();
  const criteria = encodePersonaCriteria(options.rawText);

  const existing = await db
    .select({ id: personas.id })
    .from(personas)
    .where(eq(personas.sourceDocUrl, options.sourceDocUrl))
    .limit(1);

  if (existing[0]) {
    await db
      .update(personas)
      .set({
        criteria,
        ...(options.name ? { name: options.name } : {}),
        ...(options.description ? { description: options.description } : {}),
      })
      .where(eq(personas.id, existing[0].id));
    return { personaId: existing[0].id, created: false };
  }

  if (!options.name) {
    throw new Error("A persona name is required when syncing a doc for the first time.");
  }

  const id = nanoid();
  await db.insert(personas).values({
    id,
    name: options.name,
    description: options.description ?? null,
    criteria,
    sourceDocUrl: options.sourceDocUrl,
    ownerEmail: options.ownerEmail,
    createdAt: new Date().toISOString(),
  });
  return { personaId: id, created: true };
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
