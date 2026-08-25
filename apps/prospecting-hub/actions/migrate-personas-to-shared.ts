import { defineAction } from "@agent-native/core";
import { invokeAgentAction, resolveAgentInvocationTarget } from "@agent-native/core/a2a";
import { eq } from "@agent-native/core/db/schema";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { personaDocuments, personas } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";
import { countWords, sharedPersonaDocs, sharedPersonas, personaMigrationReviews, getSharedDb } from "@xdr-hub/shared/server";

// One-time admin migration: creates the shared cross-app personas table
// (packages/shared) from both apps' existing, independently-created persona
// sets. Auto-pairs by exact case-insensitive name match; anything ambiguous
// (a name matching more than one persona on either side) or unmatched (no
// counterpart on the other side) gets its own standalone shared record PLUS
// a review-queue row so an admin can confirm/merge later -- nothing is ever
// silently merged on a guess.
//
// Deliberately does NOT repoint any existing row's personaId reference
// (contacts.personaId here, prospects.personaId/leadListItems.personaId in
// li-agent) -- see the plan's own note on why that's a separate, deferred
// pass: A2A's invokeAgentAction is read-only by design, so there's no clean
// mechanism for this app to write into li-agent's local tables, and this
// app importing li-agent's schema directly would violate the no-cross-app-
// schema-coupling boundary. This action only populates the shared table;
// going-forward actions in both apps read/write it directly.
//
// Idempotent-ish but not safe to run twice blindly: a second run would
// create a second, duplicate shared record for anything already migrated.
// Intended as a genuine one-time operation.

interface LiAgentPersonaDoc {
  fileName: string;
  content: string;
  wordCount: number;
  sortOrder: number;
}

interface LiAgentPersona {
  id: string;
  name: string;
  color: string | null;
  isActive: number;
  summary: string | null;
  briefing: string | null;
  briefingGeneratedAt: string | null;
  briefingSourceHash: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  docs: LiAgentPersonaDoc[];
}

export default defineAction({
  description:
    "One-time admin migration: creates the shared cross-app personas table from both apps' existing persona sets, auto-matching by exact name and queuing anything ambiguous or unmatched for manual review. Does not repoint existing rows' personaId references -- see the action's own comment.",
  schema: z.object({}),
  requiresAuth: true,
  http: { method: "POST" },
  run: async (_input, ctx) => {
    await requireRole(ctx?.userEmail, ["admin"]);
    const db = getDb();
    const sharedDb = getSharedDb();
    const now = new Date().toISOString();

    const phPersonas = await db.select().from(personas);
    const phDocs = await db.select().from(personaDocuments);
    // personaDocuments has no wordCount column (prospecting-hub never
    // tracked it) -- computed here so the copy into sharedPersonaDocs
    // (which does have one) isn't left null for every prospecting-hub doc.
    const phDocsByPersona = new Map<string, { fileName: string; content: string; wordCount: number }[]>();
    for (const doc of phDocs) {
      const list = phDocsByPersona.get(doc.personaId) ?? [];
      list.push({ fileName: doc.fileName, content: doc.content, wordCount: countWords(doc.content) });
      phDocsByPersona.set(doc.personaId, list);
    }

    // TEMPORARY diagnostic for the "Invalid or expired A2A token" investigation
    // -- surfaces exactly what invokeAgentAction resolves internally, since a
    // manually-minted token with the audience the chat's own describe-
    // workspace-apps tool reports verifies fine against li-agent directly.
    const resolvedTarget = await resolveAgentInvocationTarget("li-agent");

    let result;
    try {
      ({ result } = await invokeAgentAction({
        target: "li-agent",
        action: "list-icp-personas-for-migration",
        input: {},
        userEmail: ctx!.userEmail!,
      }));
    } catch (err) {
      throw new Error(
        `A2A call threw. resolvedTarget=${JSON.stringify(resolvedTarget)} err=${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (result.status !== "completed") {
      throw new Error(
        `Could not read li-agent's personas over A2A. resolvedTarget=${JSON.stringify(resolvedTarget)} result=${JSON.stringify(result)}`,
      );
    }
    const liPersonas: LiAgentPersona[] = (JSON.parse(result.output) as { personas: LiAgentPersona[] }).personas;

    // Group both sides by exact case-insensitive name.
    const byName = new Map<string, { ph: typeof phPersonas; li: LiAgentPersona[] }>();
    for (const p of phPersonas) {
      const key = p.name.trim().toLowerCase();
      const entry = byName.get(key) ?? { ph: [], li: [] };
      entry.ph.push(p);
      byName.set(key, entry);
    }
    for (const p of liPersonas) {
      const key = p.name.trim().toLowerCase();
      const entry = byName.get(key) ?? { ph: [], li: [] };
      entry.li.push(p);
      byName.set(key, entry);
    }

    let matched = 0;
    let unmatched = 0;
    let ambiguous = 0;

    async function insertSharedPersona(options: {
      name: string;
      color: string | null;
      description: string | null;
      sourceDocUrl: string | null;
      isActive: number;
      summary: string | null;
      briefing: string | null;
      briefingGeneratedAt: string | null;
      briefingSourceHash: string | null;
      ownerEmail: string | null;
      phDocsToCopy: { fileName: string; content: string; wordCount: number | null }[];
      liDocsToCopy: LiAgentPersonaDoc[];
    }): Promise<string> {
      const sharedId = nanoid();
      await sharedDb.insert(sharedPersonas).values({
        id: sharedId,
        name: options.name,
        color: options.color,
        description: options.description,
        sourceDocUrl: options.sourceDocUrl,
        isActive: options.isActive,
        summary: options.summary,
        briefing: options.briefing,
        briefingGeneratedAt: options.briefingGeneratedAt,
        briefingSourceHash: options.briefingSourceHash,
        ownerEmail: options.ownerEmail,
        createdAt: now,
        updatedAt: now,
      });

      let sortOrder = 0;
      for (const doc of options.liDocsToCopy) {
        await sharedDb.insert(sharedPersonaDocs).values({
          id: nanoid(),
          personaId: sharedId,
          fileName: `[from li-agent] ${doc.fileName}`,
          content: doc.content,
          wordCount: doc.wordCount,
          sortOrder: sortOrder++,
          createdAt: now,
        });
      }
      for (const doc of options.phDocsToCopy) {
        await sharedDb.insert(sharedPersonaDocs).values({
          id: nanoid(),
          personaId: sharedId,
          fileName: `[from prospecting-hub] ${doc.fileName}`,
          content: doc.content,
          wordCount: doc.wordCount,
          sortOrder: sortOrder++,
          createdAt: now,
        });
      }

      return sharedId;
    }

    for (const [, { ph, li }] of byName) {
      if (ph.length === 1 && li.length === 1) {
        // Confirmed 1:1 match by name -- merge directly. No review-queue
        // row: that queue is for cases needing human attention, and an
        // unambiguous single-name match on both sides doesn't.
        const phPersona = ph[0];
        const liPersona = li[0];
        await insertSharedPersona({
          name: phPersona.name,
          color: phPersona.color ?? liPersona.color,
          description: phPersona.description,
          sourceDocUrl: phPersona.sourceDocUrl,
          isActive: liPersona.isActive,
          summary: liPersona.summary,
          briefing: liPersona.briefing,
          briefingGeneratedAt: liPersona.briefingGeneratedAt,
          briefingSourceHash: liPersona.briefingSourceHash,
          ownerEmail: phPersona.ownerEmail,
          phDocsToCopy: phDocsByPersona.get(phPersona.id) ?? [],
          liDocsToCopy: liPersona.docs,
        });
        matched++;
        continue;
      }

      // Not a clean 1:1 -- every persona on both sides gets its own
      // standalone shared record so it's immediately usable, and every
      // plausible cross-app pairing gets a pending review row rather than
      // being auto-merged on a guess.
      const isAmbiguous = ph.length > 0 && li.length > 0 && (ph.length > 1 || li.length > 1);

      for (const phPersona of ph) {
        const sharedId = await insertSharedPersona({
          name: phPersona.name,
          color: phPersona.color,
          description: phPersona.description,
          sourceDocUrl: phPersona.sourceDocUrl,
          isActive: 0,
          summary: null,
          briefing: null,
          briefingGeneratedAt: null,
          briefingSourceHash: null,
          ownerEmail: phPersona.ownerEmail,
          phDocsToCopy: phDocsByPersona.get(phPersona.id) ?? [],
          liDocsToCopy: [],
        });
        if (li.length === 0) {
          await sharedDb.insert(personaMigrationReviews).values({
            id: nanoid(),
            prospectingHubPersonaId: phPersona.id,
            prospectingHubPersonaName: phPersona.name,
            liAgentPersonaId: null,
            liAgentPersonaName: null,
            reason: "unmatched",
            status: "pending",
            resolvedSharedPersonaId: sharedId,
            createdAt: now,
            resolvedAt: null,
          });
          unmatched++;
        } else {
          for (const liPersona of li) {
            await sharedDb.insert(personaMigrationReviews).values({
              id: nanoid(),
              prospectingHubPersonaId: phPersona.id,
              prospectingHubPersonaName: phPersona.name,
              liAgentPersonaId: liPersona.id,
              liAgentPersonaName: liPersona.name,
              reason: "ambiguous_name",
              status: "pending",
              resolvedSharedPersonaId: sharedId,
              createdAt: now,
              resolvedAt: null,
            });
          }
        }
      }

      for (const liPersona of li) {
        if (ph.length > 0) continue; // already covered by the ambiguous-pairing loop above
        const sharedId = await insertSharedPersona({
          name: liPersona.name,
          color: liPersona.color,
          description: null,
          sourceDocUrl: null,
          isActive: liPersona.isActive,
          summary: liPersona.summary,
          briefing: liPersona.briefing,
          briefingGeneratedAt: liPersona.briefingGeneratedAt,
          briefingSourceHash: liPersona.briefingSourceHash,
          ownerEmail: null,
          phDocsToCopy: [],
          liDocsToCopy: liPersona.docs,
        });
        await sharedDb.insert(personaMigrationReviews).values({
          id: nanoid(),
          prospectingHubPersonaId: null,
          prospectingHubPersonaName: null,
          liAgentPersonaId: liPersona.id,
          liAgentPersonaName: liPersona.name,
          reason: "unmatched",
          status: "pending",
          resolvedSharedPersonaId: sharedId,
          createdAt: now,
          resolvedAt: null,
        });
        unmatched++;
      }

      if (isAmbiguous) ambiguous++;
    }

    return { matched, unmatched, ambiguous };
  },
});
