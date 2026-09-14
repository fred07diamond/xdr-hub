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
  code?: "no_profile_url";
  prospectId?: string;
  fitVerdict?: "strong" | "possible" | "weak" | "inconclusive";
  fitReason?: string;
  draftNote?: string;
  draftFollowUp?: string | null;
  personaName?: string | null;
  personaColor?: string | null;
}

// ICP fit score + connection-note draft for a Sales Nav lead list item.
//
// Split into two halves in service of the score-first pipeline. Scoring is
// LLM-only and costs ZERO Apollo credits, so it now runs BEFORE enrichment and
// the verdict gates whether a credit gets spent at all. Promotion has to stay
// after enrichment, because that is what supplies a real linkedin.com/in/ URL
// (see promoteLeadListItem's comment on the duplicate-row gap).
//
// Reuses the exact same scoring/drafting helpers capture-profile.ts calls,
// just fed from the lead list item's own fields instead of a live page scrape
// -- there's no "About" or "recent activity" for someone who hasn't been
// visited, so those stay null.

/**
 * Scores and drafts, writing the result onto the LEAD LIST ITEM. No prospects
 * row is created.
 *
 * Note there is no longer a "needs a URL" precondition: scoring works from a
 * name and a headline, and requiring a URL would have made score-first
 * impossible for exactly the leads that have no real profile URL yet -- which
 * before enrichment is all of them.
 */
export async function scoreLeadListItem(
  db: Db,
  item: LeadListItem,
  ownerEmail: string | null,
): Promise<ScoreLeadListItemResult> {
  // Prefer the real/enriched URL when present, else the Sales Nav URL, else
  // empty. draftProfile uses this only as prompt context, never as an
  // identifier, so an empty string is acceptable here -- unlike promotion,
  // where the URL is the dedup key.
  const profileUrlForPrompt = item.profileUrl ?? item.enrichedLinkedinUrl ?? item.salesNavLeadUrl ?? "";

  // Pre-enrichment this resolves to the scraped Sales Nav headline rather than
  // Apollo's cleaner title. Accepted tradeoff of score-first: the alternative
  // is paying a credit to find out a lead is a bad fit. draftProfile's rubric
  // is title/seniority-heavy, so expect somewhat more `weak` on senior people
  // with vanity headlines -- which is why `weak` is never terminal and a
  // manual Enrich button always remains.
  const role = item.enrichedTitle ?? item.headline ?? null;
  const profile = {
    name: item.name,
    headline: item.headline,
    role,
    company: item.company,
    about: null,
    recentActivity: null,
    profileUrl: profileUrlForPrompt,
  };

  const { icpText, personaId, personaName, personaColor } = await selectPersona(db, profile);
  const profileSummary = buildProfileSummary(profile);
  const messagingContext = await buildMessagingContext(personaId, ownerEmail, db);
  const { fitVerdict, fitReason, draftNote, draftFollowUp } = await draftProfile({
    icpText,
    profileSummary,
    messagingContext,
    profileUrl: profileUrlForPrompt,
    personaId,
    personaName,
  });

  const now = new Date().toISOString();
  await db
    .update(leadListItems)
    .set({
      fitVerdict,
      fitReason,
      draftNote,
      draftFollowUp,
      personaId,
      personaName,
      personaColor,
      scoredAt: now,
      updatedAt: now,
    })
    .where(eq(leadListItems.id, item.id));

  return { ok: true, fitVerdict, fitReason, draftNote, draftFollowUp, personaName, personaColor };
}

/**
 * Promotes a scored lead into a real `prospects` row.
 *
 * **Requires a real profile URL, and the `salesNavLeadUrl` fallback is gone.**
 * That fallback is the documented duplicate-prospect-row gap in CLAUDE.md: a
 * Sales Nav lead URL carries a member URN, not the public vanity slug, so
 * capture-profile.ts can never reconcile a row keyed on one -- the same person
 * ends up as two prospects. Score-first would have made that the DEFAULT path
 * (enrichedLinkedinUrl is null at scoring time, and permanently null for any
 * lead that never gets enriched), so the gap is closed here instead of being
 * inherited at scale: a lead with no real URL keeps its verdict and draft on
 * the lead_list_items row and simply waits. list-all-prospects.ts surfaces
 * those values, so the user sees no difference.
 */
export async function promoteLeadListItem(
  db: Db,
  item: LeadListItem,
  ownerEmail: string | null,
): Promise<ScoreLeadListItemResult> {
  const profileUrl = item.profileUrl ?? item.enrichedLinkedinUrl ?? null;
  if (!profileUrl) {
    // A normal, expected outcome -- not an error. Promotion happens later,
    // once Apollo or a profile visit supplies a real URL.
    return { ok: false, code: "no_profile_url", error: "No LinkedIn profile URL yet." };
  }

  const role = item.enrichedTitle ?? item.headline ?? null;
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
        fitVerdict: item.fitVerdict,
        fitReason: item.fitReason,
        draftNote: item.draftNote,
        draftFollowUp: item.draftFollowUp,
        personaId: item.personaId,
        personaName: item.personaName,
        personaColor: item.personaColor,
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
      fitVerdict: item.fitVerdict,
      fitReason: item.fitReason,
      draftNote: item.draftNote,
      draftFollowUp: item.draftFollowUp,
      personaId: item.personaId,
      personaName: item.personaName,
      personaColor: item.personaColor,
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
      phoneRevealRequestedBy: item.phoneRevealRequestedBy,
      phoneRevealOverride: item.phoneRevealOverride,
      phoneRevealOverrideAt: item.phoneRevealOverrideAt,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Backfill the lead's own profileUrl -- this is what makes
  // list-all-prospects.ts's existing dedup suppress the shallow row in favour
  // of the richer prospects row, on the very next fetch.
  if (!item.profileUrl) {
    await db.update(leadListItems).set({ profileUrl, updatedAt: now }).where(eq(leadListItems.id, item.id));
  }

  return {
    ok: true,
    prospectId,
    fitVerdict: item.fitVerdict ?? undefined,
    fitReason: item.fitReason ?? undefined,
    draftNote: item.draftNote ?? undefined,
    draftFollowUp: item.draftFollowUp,
    personaName: item.personaName,
    personaColor: item.personaColor,
  };
}

/**
 * Score then promote if possible -- what the manual "Score & Draft" button
 * calls, so its behaviour is unchanged from the user's point of view.
 *
 * A `no_profile_url` promotion is reported as SUCCESS with no prospectId: the
 * scoring and draft did happen and are visible on the lead, so surfacing it as
 * a failure would be misleading.
 */
export async function scoreAndPromoteLeadListItem(
  db: Db,
  item: LeadListItem,
  ownerEmail: string | null,
): Promise<ScoreLeadListItemResult> {
  const scored = await scoreLeadListItem(db, item, ownerEmail);
  if (!scored.ok) return scored;

  const [fresh] = await db.select().from(leadListItems).where(eq(leadListItems.id, item.id));
  if (!fresh) return scored;

  const promoted = await promoteLeadListItem(db, fresh, ownerEmail);
  if (promoted.ok) return promoted;
  return scored;
}
