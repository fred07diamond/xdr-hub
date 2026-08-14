import { defineAction } from "@agent-native/core";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadLists, leadListItems } from "../server/db/schema.js";
import { resolveOwner } from "../server/helpers/resolve-owner.js";
import { checkRateLimit } from "../server/helpers/rate-limit.js";
import { selectPersonasBatch } from "../server/helpers/select-persona.js";

// Sales Nav lists can run into the thousands -- cap like import-hubspot-
// queue.ts's IMPORT_LIMIT so one import can't produce an unbounded insert.
const IMPORT_LIMIT = 500;

export default defineAction({
  description:
    "Import a Sales Navigator saved lead list captured by the Builder.LI extension. Shallow import only -- no ICP scoring or draft note generation happens here; that still happens later, per-lead, through the existing capture-profile flow when the xDR opens that lead's profile page.",
  schema: z.object({
    listName: z.string().describe("Name of the Sales Navigator list, or a derived/fallback name"),
    listDescription: z.string().nullish().describe("Optional description, only used when creating a new list (ignored if existingListId is set)"),
    listUrl: z.string().url().nullish().describe("URL of the Sales Navigator list page"),
    existingListId: z.string().nullish().describe("If set, append these leads to this existing list instead of creating a new one"),
    leads: z
      .array(
        z.object({
          name: z.string().nullish(),
          headline: z.string().nullish(),
          company: z.string().nullish(),
          location: z.string().nullish(),
          salesNavLeadUrl: z.string().url().nullish(),
        }),
      )
      .min(1)
      .describe("Leads accumulated across all pages of the list, deduped by salesNavLeadUrl"),
    apiToken: z.string().nullish().describe("Personal API token from Settings"),
  }),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: false, requiresAuth: false },
  run: async ({ listName, listDescription, listUrl, existingListId, leads, apiToken }, ctx) => {
    const ownerEmail = await resolveOwner(apiToken, ctx);

    if (!(await checkRateLimit(ownerEmail ?? "anonymous", "import-sales-nav-list", 20))) {
      return { listId: "", totalCount: 0, error: "Rate limit reached -- try again shortly." };
    }

    const db = getDb();

    // Defensive within-batch dedupe by salesNavLeadUrl -- the extension's
    // accumulator already dedupes client-side, but don't assume that holds
    // for every caller of this public action.
    const seenInBatch = new Set<string>();
    const withinBatchDeduped = leads.filter((lead) => {
      if (!lead.salesNavLeadUrl) return true;
      if (seenInBatch.has(lead.salesNavLeadUrl)) return false;
      seenInBatch.add(lead.salesNavLeadUrl);
      return true;
    });

    const capped = withinBatchDeduped.slice(0, IMPORT_LIMIT);
    const truncated = withinBatchDeduped.length > IMPORT_LIMIT;

    // Cross-list dedupe: a lead already captured ANYWHERE in this owner's
    // lead lists (not just the list being imported into) doesn't get
    // inserted again -- e.g. re-importing "Recommended Leads" after it
    // changed on LinkedIn shouldn't recreate every lead that was already
    // imported last time.
    const ownerFilter = ownerEmail ? eq(leadLists.ownerEmail, ownerEmail) : isNull(leadLists.ownerEmail);
    const urlsToCheck = capped.map((l) => l.salesNavLeadUrl).filter((u): u is string => !!u);
    let existingUrls = new Set<string>();
    if (urlsToCheck.length > 0) {
      const existingRows = await db
        .select({ salesNavLeadUrl: leadListItems.salesNavLeadUrl })
        .from(leadListItems)
        .innerJoin(leadLists, eq(leadListItems.listId, leadLists.id))
        .where(and(ownerFilter, inArray(leadListItems.salesNavLeadUrl, urlsToCheck)));
      existingUrls = new Set(existingRows.map((r) => r.salesNavLeadUrl).filter((u): u is string => !!u));
    }
    const deduped = capped.filter((lead) => !lead.salesNavLeadUrl || !existingUrls.has(lead.salesNavLeadUrl));
    const duplicatesSkipped = capped.length - deduped.length;

    if (deduped.length === 0) {
      return {
        listId: null,
        totalCount: 0,
        truncated,
        duplicatesSkipped,
        error: "Every lead in this import was already in one of your lead lists -- nothing new to add.",
      };
    }

    const now = new Date().toISOString();

    // Persona classification only -- a single batched LLM call (or none at
    // all, for 0/1 personas), not per-lead ICP fit scoring or draft note
    // generation. Best-effort: any failure here must not block the import
    // itself, since the import is the durable outcome that matters.
    let personaMatches: Awaited<ReturnType<typeof selectPersonasBatch>> = [];
    try {
      personaMatches = await selectPersonasBatch(
        db,
        deduped.map((lead) => ({ name: lead.name, headline: lead.headline, company: lead.company })),
      );
    } catch {
      personaMatches = [];
    }

    let listId: string;
    let positionOffset = 0;
    let newTotalCount = deduped.length;

    if (existingListId) {
      // Append to an existing list -- verify it belongs to this owner before
      // touching it, same ownerFilter used for cross-list dedup above.
      const [existingList] = await db
        .select({ id: leadLists.id, totalCount: leadLists.totalCount })
        .from(leadLists)
        .where(and(eq(leadLists.id, existingListId), ownerFilter));

      if (!existingList) {
        return {
          listId: null,
          totalCount: 0,
          truncated,
          duplicatesSkipped,
          error: "That list no longer exists or isn't yours.",
        };
      }

      listId = existingList.id;
      positionOffset = existingList.totalCount;
      newTotalCount = existingList.totalCount + deduped.length;

      await db
        .update(leadLists)
        .set({ totalCount: newTotalCount, updatedAt: now })
        .where(eq(leadLists.id, listId));
    } else {
      // Creates a new list entity, even re-importing the same listUrl -- no
      // upsert/merge by list id. Cross-list lead dedup above means
      // re-importing the same list won't duplicate leads, even though the
      // list entity itself is still recreated.
      listId = nanoid();
      await db.insert(leadLists).values({
        id: listId,
        ownerEmail,
        name: listName,
        description: listDescription ?? null,
        salesNavListUrl: listUrl ?? null,
        totalCount: deduped.length,
        createdAt: now,
        updatedAt: now,
      });
    }

    await db.insert(leadListItems).values(
      deduped.map((lead, i) => {
        const persona = personaMatches[i];
        return {
          id: nanoid(),
          listId,
          name: lead.name ?? null,
          headline: lead.headline ?? null,
          company: lead.company ?? null,
          location: lead.location ?? null,
          profileUrl: null,
          salesNavLeadUrl: lead.salesNavLeadUrl ?? null,
          position: positionOffset + i,
          personaId: persona?.personaId ?? null,
          personaName: persona?.personaName ?? null,
          personaColor: persona?.personaColor ?? null,
          createdAt: now,
          updatedAt: now,
        };
      }),
    );

    return { listId, totalCount: newTotalCount, truncated, duplicatesSkipped };
  },
});
