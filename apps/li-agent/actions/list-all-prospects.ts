import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadLists, leadListItems, prospects, prospectTags, prospectTagLinks } from "../server/db/schema.js";

// One combined, deduped view across everything this owner has ever
// captured -- the `prospects` table (profile-visit captures, richer: ICP
// fit/draft note/rating/phone-reveal) and `leadListItems` across every lead
// list (shallow Sales Nav imports). A lead list item's profileUrl is null
// until the xDR opens that lead's actual profile (see leadListItems' schema
// comment) -- once it is set, a matching prospects row exists for the same
// person, so it's suppressed here in favor of the richer prospects row.
// Cross-list dedup by salesNavLeadUrl already happens at import time
// (import-sales-nav-list.ts), so no lead list item duplicates another
// within this owner's data.
//
// This is the ONLY row backing the main Prospects page (app/routes/_index.tsx)
// now -- `rawId` (the real, unprefixed prospects.id or leadListItems.id) is
// what per-row mutations (enrich, rate, note, delete, mark-sent, add-to-list)
// must be called with; `id` is prefixed ("prospect:"/"lead_list:") only to
// keep the two id namespaces from colliding as merged React list keys.
//
// Dedup/merge happens in application code, not SQL, because it spans two
// differently-shaped tables -- both are fetched in full for this owner and
// merged/paginated in memory. Fine at today's real scale (~500 leads/day
// per rep); if this owner's combined row count grows into the tens of
// thousands, this should move to a real paginated SQL view instead.
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 5000; // upper bound used by the "export everything" CSV path

export default defineAction({
  description: "List every prospect and lead-list lead for the current user, merged and deduped into one view, paginated.",
  schema: z.object({
    limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    offset: z.number().int().min(0).default(0),
  }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ limit, offset }, ctx) => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) return { rows: [], totalCount: 0 };

    const db = getDb();
    const [prospectRows, leadListRows, tagLinkRows] = await Promise.all([
      db
        .select({
          id: prospects.id,
          name: prospects.name,
          headline: prospects.headline,
          role: prospects.role,
          company: prospects.company,
          profileUrl: prospects.profileUrl,
          fitVerdict: prospects.fitVerdict,
          fitReason: prospects.fitReason,
          draftNote: prospects.draftNote,
          draftFollowUp: prospects.draftFollowUp,
          status: prospects.status,
          rating: prospects.rating,
          ratingNote: prospects.ratingNote,
          personaId: prospects.personaId,
          personaName: prospects.personaName,
          personaColor: prospects.personaColor,
          enrichmentStatus: prospects.enrichmentStatus,
          enrichedEmail: prospects.enrichedEmail,
          enrichedTitle: prospects.enrichedTitle,
          enrichedPhone: prospects.enrichedPhone,
          enrichedLinkedinUrl: prospects.enrichedLinkedinUrl,
          enrichedCompanyIndustry: prospects.enrichedCompanyIndustry,
          enrichedCompanySize: prospects.enrichedCompanySize,
          enrichmentError: prospects.enrichmentError,
          phoneRevealStatus: prospects.phoneRevealStatus,
          phoneRevealRequestedAt: prospects.phoneRevealRequestedAt,
          createdAt: prospects.createdAt,
          updatedAt: prospects.updatedAt,
        })
        .from(prospects)
        .where(eq(prospects.ownerEmail, userEmail)),
      db
        .select({
          id: leadListItems.id,
          name: leadListItems.name,
          headline: leadListItems.headline,
          company: leadListItems.company,
          location: leadListItems.location,
          profileUrl: leadListItems.profileUrl,
          salesNavLeadUrl: leadListItems.salesNavLeadUrl,
          personaId: leadListItems.personaId,
          personaName: leadListItems.personaName,
          personaColor: leadListItems.personaColor,
          enrichmentStatus: leadListItems.enrichmentStatus,
          enrichedEmail: leadListItems.enrichedEmail,
          enrichedTitle: leadListItems.enrichedTitle,
          enrichedPhone: leadListItems.enrichedPhone,
          enrichedLinkedinUrl: leadListItems.enrichedLinkedinUrl,
          enrichedCompanyIndustry: leadListItems.enrichedCompanyIndustry,
          enrichedCompanySize: leadListItems.enrichedCompanySize,
          enrichmentError: leadListItems.enrichmentError,
          createdAt: leadListItems.createdAt,
          listName: leadLists.name,
        })
        .from(leadListItems)
        .innerJoin(leadLists, eq(leadListItems.listId, leadLists.id))
        .where(eq(leadLists.ownerEmail, userEmail)),
      db
        .select({
          prospectId: prospectTagLinks.prospectId,
          id: prospectTags.id,
          name: prospectTags.name,
          color: prospectTags.color,
        })
        .from(prospectTagLinks)
        .innerJoin(prospectTags, eq(prospectTagLinks.tagId, prospectTags.id))
        .where(eq(prospectTags.ownerEmail, userEmail)),
    ]);

    const tagsByProspectId = new Map<string, { id: string; name: string; color: string }[]>();
    for (const link of tagLinkRows) {
      const list = tagsByProspectId.get(link.prospectId) ?? [];
      list.push({ id: link.id, name: link.name, color: link.color });
      tagsByProspectId.set(link.prospectId, list);
    }

    const profileUrlSet = new Set(prospectRows.map((p) => p.profileUrl).filter((u): u is string => !!u));

    const merged = [
      ...prospectRows.map((p) => ({
        id: `prospect:${p.id}`,
        rawId: p.id,
        source: "prospect" as const,
        name: p.name,
        headline: p.headline,
        role: p.role,
        company: p.company,
        location: null as string | null,
        profileUrl: p.profileUrl,
        salesNavLeadUrl: null as string | null,
        listName: null as string | null,
        fitVerdict: p.fitVerdict,
        fitReason: p.fitReason,
        draftNote: p.draftNote,
        draftFollowUp: p.draftFollowUp,
        status: p.status as string | null,
        tags: tagsByProspectId.get(p.id) ?? [],
        rating: p.rating,
        ratingNote: p.ratingNote,
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
        enrichmentError: p.enrichmentError,
        phoneRevealStatus: p.phoneRevealStatus,
        phoneRevealRequestedAt: p.phoneRevealRequestedAt,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
      ...leadListRows
        .filter((li) => !li.profileUrl || !profileUrlSet.has(li.profileUrl))
        .map((li) => ({
          id: `lead_list:${li.id}`,
          rawId: li.id,
          source: "lead_list" as const,
          name: li.name,
          headline: li.headline,
          role: null as string | null,
          company: li.company,
          location: li.location,
          profileUrl: li.profileUrl,
          salesNavLeadUrl: li.salesNavLeadUrl,
          listName: li.listName,
          fitVerdict: null as string | null,
          fitReason: null as string | null,
          draftNote: null as string | null,
          draftFollowUp: null as string | null,
          status: null as string | null,
          tags: [] as { id: string; name: string; color: string }[],
          rating: null as number | null,
          ratingNote: null as string | null,
          personaId: li.personaId,
          personaName: li.personaName,
          personaColor: li.personaColor,
          enrichmentStatus: li.enrichmentStatus,
          enrichedEmail: li.enrichedEmail,
          enrichedTitle: li.enrichedTitle,
          enrichedPhone: li.enrichedPhone,
          enrichedLinkedinUrl: li.enrichedLinkedinUrl,
          enrichedCompanyIndustry: li.enrichedCompanyIndustry,
          enrichedCompanySize: li.enrichedCompanySize,
          enrichmentError: li.enrichmentError,
          phoneRevealStatus: null as string | null,
          phoneRevealRequestedAt: null as string | null,
          createdAt: li.createdAt,
          updatedAt: li.createdAt,
        })),
    ];

    merged.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

    const totalCount = merged.length;
    const rows = merged.slice(offset, offset + limit);
    return { rows, totalCount };
  },
});
