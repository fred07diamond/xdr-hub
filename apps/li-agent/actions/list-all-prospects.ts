import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { isEnrichmentFresh } from "../server/helpers/enrich-apollo-record.js";
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
          fitScore: prospects.fitScore,
          scoreRoleFit: prospects.scoreRoleFit,
          scoreSeniority: prospects.scoreSeniority,
          scoreCompanyFit: prospects.scoreCompanyFit,
          scoreIntent: prospects.scoreIntent,
          intentSignal: prospects.intentSignal,
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
          companyDomain: prospects.companyDomain,
          enrichedAt: prospects.enrichedAt,
          enrichmentError: prospects.enrichmentError,
          enrichmentSource: prospects.enrichmentSource,
          enrichedEmailStatus: prospects.enrichedEmailStatus,
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
          companyDomain: leadListItems.companyDomain,
          enrichedAt: leadListItems.enrichedAt,
          enrichmentError: leadListItems.enrichmentError,
          enrichmentSource: leadListItems.enrichmentSource,
          enrichedEmailStatus: leadListItems.enrichedEmailStatus,
          // Score-first means a lead carries its own verdict and draft before
          // (and possibly without ever) being promoted into a prospects row.
          fitVerdict: leadListItems.fitVerdict,
          fitScore: leadListItems.fitScore,
          scoreRoleFit: leadListItems.scoreRoleFit,
          scoreSeniority: leadListItems.scoreSeniority,
          scoreCompanyFit: leadListItems.scoreCompanyFit,
          scoreIntent: leadListItems.scoreIntent,
          intentSignal: leadListItems.intentSignal,
          fitReason: leadListItems.fitReason,
          draftNote: leadListItems.draftNote,
          draftFollowUp: leadListItems.draftFollowUp,
          phoneRevealStatus: leadListItems.phoneRevealStatus,
          phoneRevealRequestedAt: leadListItems.phoneRevealRequestedAt,
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
        fitScore: p.fitScore ?? null,
        scoreRoleFit: p.scoreRoleFit ?? null,
        scoreSeniority: p.scoreSeniority ?? null,
        scoreCompanyFit: p.scoreCompanyFit ?? null,
        scoreIntent: p.scoreIntent ?? null,
        intentSignal: p.intentSignal ?? null,
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
        companyDomain: p.companyDomain,
        enrichedAt: p.enrichedAt,
        enrichmentError: p.enrichmentError,
        enrichmentSource: p.enrichmentSource,
        // Computed SERVER-side: the 30-day freshness window lives in a
        // server helper the client cannot import, and duplicating the
        // constant in the UI is exactly how the two drift apart. The
        // bulk-enrich loop uses it to skip rows that would be a
        // server-side no-op anyway.
        enrichmentFresh: isEnrichmentFresh(p),
        enrichedEmailStatus: p.enrichedEmailStatus,
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
          // Previously hard-coded null, because a lead list item had no
          // verdict of its own -- it only got one on promotion. Score-first
          // changes that, and promotion is now DEFERRED until a real profile
          // URL exists (see promoteLeadListItem), so without this an
          // un-promoted lead would show a blank Fit column despite having
          // been scored.
          fitVerdict: li.fitVerdict as string | null,
          fitScore: li.fitScore ?? null,
          scoreRoleFit: li.scoreRoleFit ?? null,
          scoreSeniority: li.scoreSeniority ?? null,
          scoreCompanyFit: li.scoreCompanyFit ?? null,
          scoreIntent: li.scoreIntent ?? null,
          intentSignal: li.intentSignal ?? null,
          fitReason: li.fitReason as string | null,
          draftNote: li.draftNote as string | null,
          draftFollowUp: li.draftFollowUp as string | null,
          // Still null: `status` is the prospects-only captured/drafted/sent
          // lifecycle, and a lead list item has no place in it until promoted.
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
          companyDomain: li.companyDomain,
          enrichedAt: li.enrichedAt,
          enrichmentError: li.enrichmentError,
          enrichmentSource: li.enrichmentSource,
          enrichmentFresh: isEnrichmentFresh(li),
          enrichedEmailStatus: li.enrichedEmailStatus,
          phoneRevealStatus: li.phoneRevealStatus as string | null,
          phoneRevealRequestedAt: li.phoneRevealRequestedAt as string | null,
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
