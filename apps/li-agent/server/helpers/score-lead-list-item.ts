import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../db/index.js";
import { leadListItems, prospects } from "../db/schema.js";
import { buildMessagingContext } from "./build-messaging-context.js";
import { draftProfile } from "./draft-profile.js";
import { buildProfileSummary, selectPersona } from "./select-persona.js";

type Db = ReturnType<typeof getDb>;
type LeadListItem = typeof leadListItems.$inferSelect;

export interface ScoreLeadListItemResult {
  ok: boolean;
  error?: string;
  prospectId?: string;
  fitVerdict?: "strong" | "possible" | "weak" | "inconclusive";
  fitReason?: string;
  draftNote?: string;
  draftFollowUp?: string | null;
  personaName?: string | null;
  personaColor?: string | null;
}

// ICP fit score + connection-note draft for a Sales Nav lead list item,
// promoting it into a real prospect row. Shared verbatim between the manual
// action (actions/score-lead-list-item.ts, triggered from the Prospects
// page's "Score & Draft" button) and the automatic background pipeline
// (server/helpers/lead-pipeline-sweep.ts) -- one implementation so the two
// paths can't drift apart. Reuses the exact same scoring/drafting helpers
// capture-profile.ts calls, just fed from the lead list item's own fields
// instead of a live page scrape -- there's no "About" or "recent activity"
// for someone who hasn't been visited, so those stay null.
export async function scoreLeadListItem(db: Db, item: LeadListItem, ownerEmail: string | null): Promise<ScoreLeadListItemResult> {
  // Every lead list item gets a salesNavLeadUrl at import time, so it's
  // always available as a stable per-lead identifier even before the real
  // profile is enriched or visited. Prefer the real/enriched URL when
  // present. Known identity-merge tradeoff: if the real public profileUrl
  // differs once captured later via capture-profile.ts, its exact-match
  // upsert won't reconcile the two rows.
  const profileUrl = item.profileUrl ?? item.enrichedLinkedinUrl ?? item.salesNavLeadUrl ?? null;
  if (!profileUrl) {
    return { ok: false, error: "This lead has no LinkedIn URL to score against." };
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
  const messagingContext = await buildMessagingContext(personaId, ownerEmail, db);
  const { fitVerdict, fitReason, draftNote, draftFollowUp } = await draftProfile({
    icpText,
    profileSummary,
    messagingContext,
    profileUrl,
    personaId,
    personaName,
  });

  const ownerFilter = ownerEmail ? eq(prospects.ownerEmail, ownerEmail) : isNull(prospects.ownerEmail);
  const existing = await db
    .select({ id: prospects.id })
    .from(prospects)
    .where(and(eq(prospects.profileUrl, profileUrl), ownerFilter))
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
    // newly-promoted prospect row doesn't lose it.
    await db.insert(prospects).values({
      id: prospectId,
      ownerEmail,
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
      companyDomain: item.companyDomain,
      enrichedAt: item.enrichedAt,
      enrichmentError: item.enrichmentError,
      enrichmentSource: item.enrichmentSource,
      enrichedEmailStatus: item.enrichedEmailStatus,
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
    await db.update(leadListItems).set({ profileUrl, updatedAt: now }).where(eq(leadListItems.id, item.id));
  }

  return { ok: true, prospectId, fitVerdict, fitReason, draftNote, draftFollowUp, personaName, personaColor };
}
