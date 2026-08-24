import { defineAction } from "@agent-native/core";
import { and, eq, or, sql } from "@agent-native/core/db/schema";
import { getSharedDb } from "@xdr-hub/shared/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { contacts, segmentContacts, syncRecords } from "../server/db/schema.js";
import { logAnalyticsEvent } from "../server/helpers/analytics.js";
import { deriveProspectorFilters } from "../server/helpers/derive-prospector-filters.js";
import { escapeLikePattern, normalizeLinkedinUrl } from "../server/helpers/normalize-linkedin-url.js";
import { searchProspectorContacts } from "../server/helpers/prospector-client.js";
import { requireRole } from "../server/helpers/require-role.js";
import { loadScorablePersonas, scoreContactAgainstPersonas } from "../server/helpers/score-contact.js";
import { assertSegmentWritable } from "../server/helpers/segment-access.js";

export default defineAction({
  description:
    "Search CommonRoom Prospector for a persona's target contacts, upsert them into the contact pool (source: prospector), score each against personas, and add them to a segment.",
  schema: z.object({
    personaId: z.string().min(1),
    subPersonaId: z.string().nullish(),
    companyAllowList: z.array(z.string()).nullish(),
    companyDenyList: z.array(z.string()).nullish(),
    limit: z.number().int().min(1).max(200).default(20),
    segmentId: z.string().min(1),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ personaId, subPersonaId, companyAllowList, companyDenyList, limit, segmentId }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();
    const userEmail = ctx!.userEmail!;

    await assertSegmentWritable(segmentId, ctx!.userEmail!, db);

    const filters = await deriveProspectorFilters({ personaId, subPersonaId, userEmail, orgId: ctx?.orgId });
    const { records } = await searchProspectorContacts({
      orgId: ctx?.orgId,
      titleKeyword: filters.titleKeyword ?? undefined,
      seniority: filters.seniority ?? undefined,
      companyAllowList: companyAllowList ?? undefined,
      companyDenyList: companyDenyList ?? undefined,
      limit,
    });

    // Same pool of scorable personas score-contact.ts's action queries —
    // scoreContactAgainstPersonas itself picks the single best-fitting one
    // per contact.
    const personaRows = await loadScorablePersonas(getSharedDb());

    const now = new Date().toISOString();
    let imported = 0;
    let deduped = 0;
    let scored = 0;
    const scoringErrors: string[] = [];

    for (const match of records) {
      const linkedinUrl = match.linkedInHandle ? `https://www.linkedin.com/${match.linkedInHandle}` : null;

      const existing = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.externalId, match.id), eq(contacts.source, "prospector")))
        .limit(1);

      let contactId: string;
      let isCrossSourceDedup = false;
      if (existing[0]) {
        contactId = existing[0].id;
        // Mirrors sync-hubspot.ts's update path: refresh the source-of-truth
        // fields but never touch `status` here — that's per-contact worked
        // state the XDR owns, not something a re-import should reset.
        await db
          .update(contacts)
          .set({
            name: match.fullName ?? "Unknown",
            title: match.title ?? null,
            company: match.companyName ?? null,
            email: null,
            linkedinUrl,
            syncedAt: now,
            updatedAt: now,
          })
          .where(eq(contacts.id, contactId));
      } else {
        // No same-source (externalId, source="prospector") row exists yet —
        // but this match might still be a contact we already have from a
        // DIFFERENT source (HubSpot, CommonRoom, or another Prospector row
        // that for some reason didn't match on externalId). Check by email
        // (defensive — Prospector itself never provides one today, see
        // `email: null` below) and by normalized LinkedIn vanity-slug before
        // deciding this is truly a new person.
        const matchEmail = (match as { email?: string | null }).email ?? null;
        const linkedinSlug = normalizeLinkedinUrl(linkedinUrl);

        const dedupConditions = [];
        if (matchEmail) {
          dedupConditions.push(sql`LOWER(${contacts.email}) = LOWER(${matchEmail})`);
        }
        if (linkedinSlug) {
          // Coarse SQL-level candidate filter only — `LIKE '%slug%'` is a
          // SUBSTRING match, and LinkedIn allocates "name-2", "name-marketing"
          // etc. when the base slug "name" is already taken, so a shorter
          // slug can substring-match into a longer, genuinely different
          // person's URL. This LIKE only narrows a bounded candidate set (no
          // full table scan); the actual accept/reject decision is an EXACT
          // normalized-slug comparison in application code below.
          dedupConditions.push(
            sql`LOWER(${contacts.linkedinUrl}) LIKE LOWER(${`%${escapeLikePattern(linkedinSlug)}%`}) ESCAPE '\\'`,
          );
        }

        const dedupCandidates =
          dedupConditions.length > 0
            ? await db
                .select({ id: contacts.id, email: contacts.email, linkedinUrl: contacts.linkedinUrl })
                .from(contacts)
                .where(or(...dedupConditions))
                .limit(25)
            : [];

        // Narrow the coarse candidates down to a genuine duplicate: exact
        // case-insensitive email equality, or an exact normalized-slug
        // match (not substring) against each candidate's own stored
        // linkedinUrl. If no candidate exactly matches, this is treated
        // exactly as if the coarse filter had found nothing at all — falls
        // through to creating a new contact.
        const crossSourceMatch = dedupCandidates.find((candidate) => {
          if (matchEmail && candidate.email && candidate.email.toLowerCase() === matchEmail.toLowerCase()) {
            return true;
          }
          if (linkedinSlug && normalizeLinkedinUrl(candidate.linkedinUrl) === linkedinSlug) {
            return true;
          }
          return false;
        });

        if (crossSourceMatch) {
          // Belongs to a different sync pipeline that owns its own
          // field-refresh cadence — don't create a duplicate row and don't
          // touch its name/title/company/etc; a Prospector guess
          // overwriting HubSpot-synced fields would fight with HubSpot's
          // own sync.
          contactId = crossSourceMatch.id;
          isCrossSourceDedup = true;
        } else {
          contactId = nanoid();
          await db.insert(contacts).values({
            id: contactId,
            name: match.fullName ?? "Unknown",
            title: match.title ?? null,
            company: match.companyName ?? null,
            email: null, // Prospector has no email field — never invent or backfill one.
            linkedinUrl,
            source: "prospector",
            externalId: match.id,
            status: "active",
            syncedAt: now,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      if (isCrossSourceDedup) {
        deduped++;
      } else {
        imported++;
      }

      // Wrapped so a single contact's bad AI response (e.g. truncated/
      // unparseable JSON) or a CommonRoom lookup failure can't abort the
      // rest of the batch — this contact is already correctly imported
      // above regardless; a scoring failure just leaves it unscored for
      // now, re-scorable later via "Refresh scores".
      try {
        const score = await scoreContactAgainstPersonas({
          contact: { name: match.fullName ?? "Unknown", title: match.title ?? null, company: match.companyName ?? null },
          personas: personaRows,
          userEmail,
          orgId: ctx?.orgId,
        });
        await db
          .update(contacts)
          .set({
            personaId: score.personaId,
            personaMatchScore: score.personaMatchScore,
            companyFitScore: score.companyFitScore,
            engagementScore: score.engagementScore,
            commonRoomIntentScore: score.commonRoomIntentScore,
            commonRoomCompanyFitScore: score.commonRoomCompanyFitScore,
            overallScore: score.overallScore,
            scoreReasoning: score.reasoning,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(contacts.id, contactId));
        scored++;
      } catch (err) {
        scoringErrors.push(`${contactId} (${match.fullName ?? "Unknown"}): ${err instanceof Error ? err.message : String(err)}`);
      }

      // Link into the segment regardless of whether scoring succeeded — the
      // contact was legitimately found by this search either way.
      const existingLink = await db
        .select({ id: segmentContacts.id })
        .from(segmentContacts)
        .where(and(eq(segmentContacts.segmentId, segmentId), eq(segmentContacts.contactId, contactId)))
        .limit(1);
      if (!existingLink[0]) {
        await db.insert(segmentContacts).values({ id: nanoid(), segmentId, contactId });
      }
    }

    const syncCompletedAt = new Date().toISOString();
    await db.insert(syncRecords).values({
      id: nanoid(),
      source: "prospector",
      startedAt: syncCompletedAt,
      completedAt: syncCompletedAt,
      status: "success",
      recordsPulled: records.length,
      metadata: JSON.stringify({ scoringErrorCount: scoringErrors.length, deduped }),
    });
    await logAnalyticsEvent(userEmail, "sync_run", {
      source: "prospector",
      status: "success",
      recordsPulled: records.length,
      scoringErrorCount: scoringErrors.length,
      deduped,
    });

    return { imported, scored, deduped, segmentId, scoringErrors };
  },
});
