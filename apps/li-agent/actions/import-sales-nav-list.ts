import { defineAction } from "@agent-native/core";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadLists, leadListItems } from "../server/db/schema.js";
import { resolveOwner, resolveOwnerStrict } from "../server/helpers/resolve-owner.js";
import { checkRateLimit } from "../server/helpers/rate-limit.js";
import { selectPersonasBatch } from "../server/helpers/select-persona.js";
import { incrementLeadCounter } from "../server/helpers/lead-counters.js";

// Sales Nav lists can run into the thousands -- cap like import-hubspot-
// queue.ts's IMPORT_LIMIT so one import can't produce an unbounded insert.
const IMPORT_LIMIT = 500;

export default defineAction({
  description:
    "Import a Sales Navigator saved lead list captured by the LinkedIn Agent extension, or add a single profile from the extension's 'Add to list' action (one lead, carrying a real profileUrl instead of a salesNavLeadUrl). The import itself stays a fast, shallow insert -- Apollo enrichment, ICP fit scoring, and connection-note drafting run afterward, automatically and in the background (server/helpers/lead-pipeline-sweep.ts), independent of the extension or browser staying open.",
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
          // Set when this lead came from the extension's single-profile
          // "Add to list" flow (a real linkedin.com/in/... URL) rather than
          // a Sales Nav list page, which only ever has a salesNavLeadUrl.
          // Stored on the row so it dedupes cleanly against a later real
          // profile visit (capture-profile.ts) instead of hitting the
          // salesNavLeadUrl-fallback duplicate-row gap documented in
          // CLAUDE.md.
          profileUrl: z.string().url().nullish(),
        }),
      )
      .min(1)
      .describe("Leads accumulated across all pages of the list (or a single lead from the extension's 'Add to list' action), deduped by salesNavLeadUrl/profileUrl"),
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

    // Defensive within-batch dedupe by salesNavLeadUrl/profileUrl -- the
    // extension's accumulator already dedupes client-side, but don't assume
    // that holds for every caller of this public action. profileUrl matters
    // here too now: the extension's single-profile "Add to list" action
    // (unlike a Sales Nav list import) sends a real linkedin.com/in/... URL
    // instead of a salesNavLeadUrl.
    const seenInBatch = new Set<string>();
    const withinBatchDeduped = leads.filter((lead) => {
      const key = lead.salesNavLeadUrl || lead.profileUrl;
      if (!key) return true;
      if (seenInBatch.has(key)) return false;
      seenInBatch.add(key);
      return true;
    });

    const capped = withinBatchDeduped.slice(0, IMPORT_LIMIT);
    const truncated = withinBatchDeduped.length > IMPORT_LIMIT;

    // Cross-list dedupe: a lead already captured ANYWHERE in this owner's
    // lead lists (not just the list being imported into) doesn't get
    // inserted again -- e.g. re-importing "Recommended Leads" after it
    // changed on LinkedIn shouldn't recreate every lead that was already
    // imported last time, and re-clicking "Add to list" on a profile
    // already added this way shouldn't create a second row for them either.
    const ownerFilter = ownerEmail ? eq(leadLists.ownerEmail, ownerEmail) : isNull(leadLists.ownerEmail);
    const salesNavUrlsToCheck = capped.map((l) => l.salesNavLeadUrl).filter((u): u is string => !!u);
    const profileUrlsToCheck = capped.map((l) => l.profileUrl).filter((u): u is string => !!u);
    let existingSalesNavUrls = new Set<string>();
    let existingProfileUrls = new Set<string>();
    if (salesNavUrlsToCheck.length > 0) {
      const existingRows = await db
        .select({ salesNavLeadUrl: leadListItems.salesNavLeadUrl })
        .from(leadListItems)
        .innerJoin(leadLists, eq(leadListItems.listId, leadLists.id))
        .where(and(ownerFilter, inArray(leadListItems.salesNavLeadUrl, salesNavUrlsToCheck)));
      existingSalesNavUrls = new Set(existingRows.map((r) => r.salesNavLeadUrl).filter((u): u is string => !!u));
    }
    if (profileUrlsToCheck.length > 0) {
      const existingRows = await db
        .select({ profileUrl: leadListItems.profileUrl })
        .from(leadListItems)
        .innerJoin(leadLists, eq(leadListItems.listId, leadLists.id))
        .where(and(ownerFilter, inArray(leadListItems.profileUrl, profileUrlsToCheck)));
      existingProfileUrls = new Set(existingRows.map((r) => r.profileUrl).filter((u): u is string => !!u));
    }
    const deduped = capped.filter((lead) => {
      if (lead.salesNavLeadUrl && existingSalesNavUrls.has(lead.salesNavLeadUrl)) return false;
      if (lead.profileUrl && existingProfileUrls.has(lead.profileUrl)) return false;
      return true;
    });
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
      // Appending into a specific pre-existing list is a targeted write, not
      // just spraying a new, distinguishable list -- require a REAL
      // credential here (session or valid token), never the
      // WORKSPACE_OWNER_EMAIL env fallback that resolveOwner above allows.
      const strictOwnerEmail = await resolveOwnerStrict(apiToken, ctx);
      if (!strictOwnerEmail) {
        return {
          listId: null,
          totalCount: 0,
          truncated,
          duplicatesSkipped,
          error: "A personal API token is required to add leads to an existing list.",
        };
      }

      // Verify the list belongs to this owner before touching it, same
      // ownerFilter used for cross-list dedup above.
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
          profileUrl: lead.profileUrl ?? null,
          salesNavLeadUrl: lead.salesNavLeadUrl ?? null,
          position: positionOffset + i,
          personaId: persona?.personaId ?? null,
          personaName: persona?.personaName ?? null,
          personaColor: persona?.personaColor ?? null,
          // Opts every newly-imported lead into the automatic enrich ->
          // score -> draft background pipeline (server/helpers/
          // lead-pipeline-sweep.ts). Every imported lead is expected to be
          // reached out to, so this is unconditional for new imports --
          // pre-existing rows stay excluded (see schema.ts comment).
          autoEnrich: 1,
          createdAt: now,
          updatedAt: now,
        };
      }),
    );

    await incrementLeadCounter(ownerEmail, deduped.length);

    return { listId, totalCount: newTotalCount, truncated, duplicatesSkipped };
  },
});
