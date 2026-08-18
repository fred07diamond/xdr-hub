import { defineAction } from "@agent-native/core";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadLists, leadListItems, prospects } from "../server/db/schema.js";
import { buildMessagingContext } from "../server/helpers/build-messaging-context.js";
import { draftProfile } from "../server/helpers/draft-profile.js";
import { buildProfileSummary, selectPersona } from "../server/helpers/select-persona.js";
import { checkRateLimit } from "../server/helpers/rate-limit.js";

// Generates a real ICP fit score + draft connection note for a Sales Nav
// lead list item that hasn't been visited yet -- normally this only happens
// via capture-profile.ts when a rep opens the actual LinkedIn profile page
// (see CLAUDE.md's Lead Lists section). This is a deliberate, separate,
// user-triggered action so enrich-lead-list-item.ts (Apollo data lookup)
// stays exactly what it always was everywhere it's used -- a data lookup,
// not a fit judgment. Reuses the exact same scoring/drafting helpers
// capture-profile.ts calls, just fed from the lead list item's own fields
// instead of a live page scrape -- there's no "About" or "recent activity"
// for someone who hasn't been visited, so those stay null, same as
// capture-profile does when the extension doesn't send them.
export default defineAction({
  description: "Score ICP fit and draft a connection note for a not-yet-visited Sales Navigator lead list item, promoting it into a real prospect row.",
  schema: z.object({ itemId: z.string() }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ itemId }, ctx) => {
    const db = getDb();
    const userEmail = ctx!.userEmail!;

    const itemRows = await db.select().from(leadListItems).where(eq(leadListItems.id, itemId));
    const item = itemRows[0];
    if (!item) return { ok: false, error: "Lead not found." };
    const listRows = await db.select().from(leadLists).where(eq(leadLists.id, item.listId));
    if (!listRows[0] || listRows[0].ownerEmail !== userEmail) return { ok: false, error: "Not authorized." };

    // Raised from 60/hr (which matched capture-profile.ts's single-profile-
    // visit pattern) -- live-confirmed this was actively blocking real usage:
    // Score & Draft gets run in bulk across a freshly-imported list in one
    // sitting, the same "~500 leads/day" pattern enrich-lead-list-item.ts
    // was raised for, not a slow trickle of one-at-a-time profile visits.
    if (!(await checkRateLimit(userEmail, "score-lead-list-item", 500))) {
      return { ok: false, error: "Rate limit reached -- try again shortly." };
    }
    // Deliberately no isOverDailyLimit check here, unlike capture-profile.ts.
    // That cap paces actual SENT outreach volume -- but this action only
    // prepares a draft; a human still has to review it and click "Mark sent"
    // separately (the same as any other prospect). Gating bulk drafting
    // behind a daily send-pacing cap would trip on the very first batch of
    // a freshly-imported list, defeating the point of a bulk-drafting
    // feature -- live-confirmed this exact failure mode on real usage.

    const profileUrl = item.profileUrl ?? item.enrichedLinkedinUrl ?? null;
    if (!profileUrl) {
      return { ok: false, error: "Enrich this lead first (or visit their profile in LinkedIn) to resolve a LinkedIn URL before scoring." };
    }

    const role = item.enrichedTitle ?? item.headline ?? null;
    const profile = {
      name: item.name,
      headline: item.headline,
      role,
      company: item.company,
      about: null,
      recentActivity: null,
      profileUrl,
    };

    const { icpText, personaId, personaName, personaColor } = await selectPersona(db, profile);
    const profileSummary = buildProfileSummary(profile);
    const messagingContext = await buildMessagingContext(personaId, userEmail, db);
    const { fitVerdict, fitReason, draftNote, draftFollowUp } = await draftProfile({
      icpText,
      profileSummary,
      messagingContext,
      profileUrl,
    });

    const existing = await db
      .select({ id: prospects.id })
      .from(prospects)
      .where(and(eq(prospects.profileUrl, profileUrl), eq(prospects.ownerEmail, userEmail)))
      .limit(1);
    const now = new Date().toISOString();
    const prospectId = existing[0]?.id ?? nanoid();

    if (existing[0]) {
      await db
        .update(prospects)
        .set({
          name: item.name,
          headline: item.headline,
          role,
          company: item.company,
          fitVerdict,
          fitReason,
          draftNote,
          draftFollowUp,
          personaId,
          personaName,
          personaColor,
          status: "drafted",
          updatedAt: now,
        })
        .where(eq(prospects.id, prospectId));
    } else {
      // Carry over whatever Apollo enrichment this lead already has so the
      // newly-promoted prospect row doesn't lose it -- this lead may
      // already have been enriched via enrich-lead-list-item.ts.
      await db.insert(prospects).values({
        id: prospectId,
        ownerEmail: userEmail,
        profileUrl,
        name: item.name,
        headline: item.headline,
        role,
        company: item.company,
        about: null,
        recentActivity: null,
        fitVerdict,
        fitReason,
        draftNote,
        draftFollowUp,
        personaId,
        personaName,
        personaColor,
        status: "drafted",
        enrichmentStatus: item.enrichmentStatus,
        enrichedEmail: item.enrichedEmail,
        enrichedTitle: item.enrichedTitle,
        enrichedPhone: item.enrichedPhone,
        enrichedLinkedinUrl: item.enrichedLinkedinUrl,
        enrichedCompanyIndustry: item.enrichedCompanyIndustry,
        enrichedCompanySize: item.enrichedCompanySize,
        enrichedAt: item.enrichedAt,
        enrichmentError: item.enrichmentError,
        phoneRevealStatus: item.phoneRevealStatus,
        phoneRevealRequestId: item.phoneRevealRequestId,
        phoneRevealRequestedAt: item.phoneRevealRequestedAt,
        createdAt: now,
        updatedAt: now,
      });
    }

    // If this lead's own profileUrl was still null, backfill it with the
    // Apollo-resolved URL -- this is what makes list-all-prospects.ts's
    // existing dedup suppress this shallow row in favor of the richer
    // prospects row we just wrote, on the very next fetch.
    if (!item.profileUrl && profileUrl) {
      await db.update(leadListItems).set({ profileUrl, updatedAt: now }).where(eq(leadListItems.id, itemId));
    }

    return { ok: true, fitVerdict, fitReason, draftNote, draftFollowUp, personaName, personaColor };
  },
});
