import { defineAction } from "@agent-native/core";
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { prospects, leadLists, leadListItems } from "../server/db/schema.js";

// Lets the Prospects table build a Lead List too, not just Sales Nav
// captures via the extension. Converts selected prospects into
// lead_list_items rows -- same table, same downstream features (Apollo
// enrichment, phone reveal, Apollo CSV export) apply automatically once
// they're in a list, since both tables already share the same enrichment
// column shape.
export default defineAction({
  description: "Add selected prospects to a new or existing Lead List.",
  schema: z.object({
    prospectIds: z.array(z.string()).min(1),
    existingListId: z.string().nullish().describe("If set, append to this existing list instead of creating a new one"),
    newListName: z.string().nullish(),
    newListDescription: z.string().nullish(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ prospectIds, existingListId, newListName, newListDescription }, ctx) => {
    const ownerEmail = ctx?.userEmail;
    if (!ownerEmail) throw new Error("Not authorized");
    const db = getDb();

    const rows = await db
      .select()
      .from(prospects)
      .where(and(inArray(prospects.id, prospectIds), eq(prospects.ownerEmail, ownerEmail)));
    if (rows.length === 0) {
      return { listId: null, addedCount: 0, duplicatesSkipped: 0, error: "No matching prospects found." };
    }

    const now = new Date().toISOString();
    let listId: string;
    let positionOffset = 0;

    if (existingListId) {
      const [existingList] = await db
        .select({ id: leadLists.id, totalCount: leadLists.totalCount })
        .from(leadLists)
        .where(and(eq(leadLists.id, existingListId), eq(leadLists.ownerEmail, ownerEmail)));
      if (!existingList) {
        return { listId: null, addedCount: 0, duplicatesSkipped: 0, error: "That list no longer exists or isn't yours." };
      }
      listId = existingList.id;
      positionOffset = existingList.totalCount;
    } else {
      if (!newListName?.trim()) {
        return { listId: null, addedCount: 0, duplicatesSkipped: 0, error: "Give the new list a name." };
      }
      listId = nanoid();
      await db.insert(leadLists).values({
        id: listId,
        ownerEmail,
        name: newListName.trim(),
        description: newListDescription?.trim() || null,
        salesNavListUrl: null,
        totalCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Dedupe against what's already in THIS target list only -- unlike the
    // Sales Nav import's global cross-list dedupe (which exists to stop a
    // re-scraped daily feed from duplicating), a deliberate multi-select
    // here may legitimately want the same prospect in more than one
    // curated list for different campaigns.
    const targetProfileUrls = rows.map((r) => r.profileUrl);
    const existingInTarget = await db
      .select({ profileUrl: leadListItems.profileUrl })
      .from(leadListItems)
      .where(and(eq(leadListItems.listId, listId), inArray(leadListItems.profileUrl, targetProfileUrls)));
    const existingSet = new Set(existingInTarget.map((r) => r.profileUrl).filter((u): u is string => !!u));
    const toAdd = rows.filter((r) => !existingSet.has(r.profileUrl));
    const duplicatesSkipped = rows.length - toAdd.length;

    if (toAdd.length === 0) {
      return { listId, addedCount: 0, duplicatesSkipped, error: "Every selected prospect is already in that list." };
    }

    await db.insert(leadListItems).values(
      toAdd.map((p, i) => ({
        id: nanoid(),
        listId,
        name: p.name,
        // leadListItems.headline holds a job title -- prospects.role is the
        // closer match; prospects.headline is LinkedIn's free-text headline.
        headline: p.role ?? p.headline,
        company: p.company,
        location: null,
        profileUrl: p.profileUrl,
        salesNavLeadUrl: null,
        position: positionOffset + i,
        personaId: p.personaId,
        personaName: p.personaName,
        personaColor: p.personaColor,
        enrichmentStatus: p.enrichmentStatus,
        enrichedEmail: p.enrichedEmail,
        enrichedTitle: p.enrichedTitle,
        enrichedPhone: p.enrichedPhone,
        enrichedLinkedinUrl: p.enrichedLinkedinUrl,
        enrichedCompanyIndustry: p.enrichedCompanyIndustry,
        enrichedCompanySize: p.enrichedCompanySize,
        companyDomain: p.companyDomain,
        enrichedAt: p.enrichedAt,
        enrichmentError: p.enrichmentError,
        enrichmentSource: p.enrichmentSource,
        enrichedEmailStatus: p.enrichedEmailStatus,
        phoneRevealStatus: p.phoneRevealStatus,
        phoneRevealRequestId: p.phoneRevealRequestId,
        phoneRevealRequestedAt: p.phoneRevealRequestedAt,
        createdAt: now,
        updatedAt: now,
      })),
    );

    const newTotalCount = positionOffset + toAdd.length;
    await db.update(leadLists).set({ totalCount: newTotalCount, updatedAt: now }).where(eq(leadLists.id, listId));

    return { listId, addedCount: toAdd.length, duplicatesSkipped };
  },
});
