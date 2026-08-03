import { eq } from "@agent-native/core/db/schema";
import type { getDb } from "../db/index.js";
import { personaDocuments, personas } from "../db/schema.js";
import { encodePersonaCriteria } from "./persona-sync.js";

// Recomputes a persona's `criteria` column as a concatenation of all of its
// persona_documents rows, ordered oldest-first, each delimited by its file
// name. Every existing scoring/grounding code path reads persona criteria
// via decodePersonaCriteria(personaRow.criteria) — as long as this stays the
// only writer of that column for multi-file personas, none of those readers
// need to change. Call this after any insert/delete against
// persona_documents for a given persona.
export async function recombinePersonaCriteria(
  personaId: string,
  db: ReturnType<typeof getDb>,
): Promise<void> {
  const docs = await db
    .select({ fileName: personaDocuments.fileName, content: personaDocuments.content })
    .from(personaDocuments)
    .where(eq(personaDocuments.personaId, personaId))
    // Passing the column directly (not wrapped in desc()) sorts ascending —
    // this package's db/schema re-export only provides `desc`, not `asc`.
    .orderBy(personaDocuments.createdAt);

  if (docs.length === 0) {
    await db.update(personas).set({ criteria: null }).where(eq(personas.id, personaId));
    return;
  }

  const combined = docs.map((d) => `--- ${d.fileName} ---\n${d.content}`).join("\n\n");
  await db
    .update(personas)
    .set({ criteria: encodePersonaCriteria(combined) })
    .where(eq(personas.id, personaId));
}
