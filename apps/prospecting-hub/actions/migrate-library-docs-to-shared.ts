import { defineAction } from "@agent-native/core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { libraryDocs, personas } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";
import { getSharedDb, sharedLibraryDocs, sharedPersonas } from "@xdr-hub/shared/server";

// One-time admin migration, companion to migrate-personas-to-shared.ts:
// copies prospecting-hub's local libraryDocs into the shared cross-app
// sharedLibraryDocs table (packages/shared) so li-agent can read the same
// Sales Library docs. A doc's linkedPersonaId pointed at a prospecting-hub-
// only persona id, which li-agent can't resolve at all -- this repoints it
// to the new shared persona id by exact-name lookup (the same identity the
// persona migration itself used), since that migration doesn't return an
// old-id -> new-id map to reuse directly.
//
// A repoint only happens when the old persona's name matches exactly ONE
// sharedPersonas row -- an ambiguous name (multiple shared personas sharing
// it, from the persona migration's own ambiguous-match path) is left
// unresolved rather than guessed; the doc keeps its stale old-app-only id
// and shows up in `personaLinksUnresolved` for manual fixup via
// update-library-doc.
//
// Idempotent-ish but not safe to run twice blindly, same caveat as
// migrate-personas-to-shared.ts -- a second run duplicates every doc.

export default defineAction({
  description:
    "One-time admin migration: copies prospecting-hub's Sales Library docs into the shared cross-app library table, repointing persona links to the new shared persona ids where the name match is unambiguous.",
  schema: z.object({}),
  requiresAuth: true,
  http: { method: "POST" },
  run: async (_input, ctx) => {
    await requireRole(ctx?.userEmail, ["admin"]);
    const db = getDb();
    const sharedDb = getSharedDb();
    const now = new Date().toISOString();

    const docs = await db.select().from(libraryDocs);
    const oldPersonas = await db.select({ id: personas.id, name: personas.name }).from(personas);
    const oldPersonaNameById = new Map(oldPersonas.map((p) => [p.id, p.name.trim().toLowerCase()]));

    const sharedPersonaRows = await sharedDb.select({ id: sharedPersonas.id, name: sharedPersonas.name }).from(sharedPersonas);
    const sharedIdsByName = new Map<string, string[]>();
    for (const p of sharedPersonaRows) {
      const key = p.name.trim().toLowerCase();
      const list = sharedIdsByName.get(key) ?? [];
      list.push(p.id);
      sharedIdsByName.set(key, list);
    }

    let migrated = 0;
    let personaLinksResolved = 0;
    let personaLinksUnresolved = 0;

    for (const doc of docs) {
      let linkedPersonaId = doc.linkedPersonaId;
      if (linkedPersonaId) {
        const oldName = oldPersonaNameById.get(linkedPersonaId);
        const candidates = oldName ? sharedIdsByName.get(oldName) ?? [] : [];
        if (candidates.length === 1) {
          linkedPersonaId = candidates[0];
          personaLinksResolved++;
        } else {
          personaLinksUnresolved++;
        }
      }

      await sharedDb.insert(sharedLibraryDocs).values({
        id: nanoid(),
        name: doc.name,
        category: doc.category,
        tags: doc.tags,
        content: doc.content,
        linkedPersonaId,
        linkedIcpId: doc.linkedIcpId,
        sourceFileName: doc.sourceFileName,
        ownerEmail: doc.ownerEmail,
        createdAt: doc.createdAt ?? now,
      });
      migrated++;
    }

    return { migrated, personaLinksResolved, personaLinksUnresolved };
  },
});
