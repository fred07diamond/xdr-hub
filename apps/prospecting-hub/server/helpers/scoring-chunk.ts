import { and, eq, inArray, isNull, or, sql } from "@agent-native/core/db/schema";
import { getSharedDb } from "@xdr-hub/shared/server";
import { nanoid } from "nanoid";
import type { getDb } from "../db/index.js";
import { contacts, segmentContacts, sourcingRuleRunTargets } from "../db/schema.js";
import { warmLeadScoreIdCache } from "./commonroom-engagement.js";
import { SCORING_TIME_BUDGET_MS, withinTimeBudget } from "./invocation-budget.js";
import { loadScorablePersonas, scoreContactAgainstPersonas } from "./score-contact.js";

type Db = ReturnType<typeof getDb>;

// Extracted from run-sourcing-rule-pipeline.ts (originally its own inline
// runScoringChunk/scoreAndLinkTarget) so run-marketing-rule-pipeline.ts can
// share the exact same atomic-claim/reclaim/concurrency/time-budget logic
// instead of a second hand-copied version — this session hit several real
// bugs in this exact code (claim races, stale claims, timeouts), and a
// second copy is a correctness liability the moment one of those needs
// fixing again and the other pipeline is forgotten. Nothing here is tied to
// a specific rule kind: it only ever reads contacts/personas and writes
// contacts/segmentContacts/sourcingRuleRunTargets, keyed purely by
// syncRecordId/segmentId/ownerEmail/orgId.
//
// Deliberately does NOT own "is the whole run finished" (finishRun)
// orchestration or the sync_records.metadata checkpoint write — those differ
// per rule kind (Prospector's metadata carries titleKeywords/seniorities/
// companiesConsidered; a Marketing rule's carries lifecycleStages instead),
// so each pipeline action reads its own rule-specific metadata before
// calling this, and decides what to do with the result (checkpoint vs. call
// its own finishRun) after.
export const SCORING_CHUNK_SIZE = 16;
export const CONCURRENCY_LIMIT = 4;

// A PER-ROW liveness check, distinct from a whole-run staleness check (which
// only ever runs on a fresh-start path) — a syncRecordId-carrying resume call
// dispatches straight into this batch and never touches that whole-run
// check at all, so if an invocation crashes after claiming rows (flipping
// them "pending" -> "claimed") but before finishing them, those specific
// rows would otherwise stay "claimed" forever on the normal resume path.
// Deliberately much shorter than a whole-run staleness window: a single
// scoring chunk is at most SCORING_CHUNK_SIZE (16) contacts, processed in
// CONCURRENCY_LIMIT-wide batches (4 sequential batches of 4), each contact
// bounded by the existing ~20s CommonRoom MCP timeout plus one bounded LLM
// completeText() call. What actually bounds a single invocation's lifetime
// is the hosting platform's own function timeout, which hard-kills any one
// HTTP call to either pipeline well before this threshold — so a "claimed"
// row still owned by a genuinely-alive invocation can never age past it;
// only a crashed/killed invocation's rows ever will, which is exactly the
// case this reclaim is meant to self-heal.
export const CLAIM_STALE_AFTER_MS = 2 * 60_000;

export interface ScoringBatchResult {
  scored: number;
  scoringErrorCount: number;
  remaining: number;
  scoringErrors: string[];
}

/**
 * Claims and scores up to SCORING_CHUNK_SIZE `pending` rows from a run's
 * sourcingRuleRunTargets queue, bounded by CONCURRENCY_LIMIT-wide batches and
 * SCORING_TIME_BUDGET_MS. Returns the queue's own aggregate counts (not an
 * in-memory counter) since nothing in-memory survives between invocations —
 * the caller reads `remaining` to decide whether to checkpoint-and-continue
 * or treat the run as finished.
 */
export async function runScoringBatch(params: {
  db: Db;
  syncRecordId: string;
  segmentId: string;
  ownerEmail: string;
  orgId: string | null | undefined;
  invocationStartedAt: number;
}): Promise<ScoringBatchResult> {
  const { db, syncRecordId, segmentId, ownerEmail, orgId, invocationStartedAt } = params;

  // Reclaim any row for THIS run that's been stuck "claimed" longer than
  // CLAIM_STALE_AFTER_MS — runs at the very start of every invocation, before
  // this invocation even looks at what's pending, so a run that's entirely
  // stuck on abandoned claims self-heals within this same call instead of
  // returning zero progress forever. Also clears the stale claimToken left
  // in `error` so the next real claim attempt starts clean.
  const claimStaleCutoff = new Date(Date.now() - CLAIM_STALE_AFTER_MS).toISOString();
  await db
    .update(sourcingRuleRunTargets)
    .set({ status: "pending", claimedAt: null, error: null })
    .where(
      and(
        eq(sourcingRuleRunTargets.syncRecordId, syncRecordId),
        eq(sourcingRuleRunTargets.status, "claimed"),
        or(isNull(sourcingRuleRunTargets.claimedAt), sql`${sourcingRuleRunTargets.claimedAt} < ${claimStaleCutoff}`),
      ),
    );

  // "Outstanding" = pending OR claimed — NOT just pending. A concurrent
  // invocation can hold a batch of rows "claimed" (mid-processing, not yet
  // scored/errored) at the exact moment this invocation checks in; counting
  // only pending rows would let this invocation wrongly conclude the run is
  // complete while that other work is still in flight.
  const [outstandingCountRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(sourcingRuleRunTargets)
    .where(
      and(eq(sourcingRuleRunTargets.syncRecordId, syncRecordId), inArray(sourcingRuleRunTargets.status, ["pending", "claimed"])),
    );
  const outstandingBeforeThisChunk = Number(outstandingCountRow?.count ?? 0);

  if (outstandingBeforeThisChunk === 0) {
    return await readCurrentCounts(db, syncRecordId);
  }

  const candidateRows = await db
    .select({ id: sourcingRuleRunTargets.id, contactId: sourcingRuleRunTargets.contactId })
    .from(sourcingRuleRunTargets)
    .where(and(eq(sourcingRuleRunTargets.syncRecordId, syncRecordId), eq(sourcingRuleRunTargets.status, "pending")))
    .orderBy(sourcingRuleRunTargets.createdAt)
    .limit(SCORING_CHUNK_SIZE);

  // Atomic claim: two concurrent scoring-chunk calls against the SAME
  // syncRecordId (a double-click, a manual run overlapping a scheduled fire,
  // a network retry) could otherwise both select and score the SAME pending
  // rows — doubled contact writes, doubled segment-link attempts, doubled
  // real LLM spend. Flipping "pending" -> "claimed" via an UPDATE re-guarded
  // by `status = "pending"` is atomic per row at the database level; a fresh
  // per-invocation `claimToken` (written into the otherwise-idle `error`
  // column while a row is "claimed") lets the re-select distinguish "claimed
  // by MY update" from "claimed by a different concurrent invocation moments
  // earlier". candidateRows can legitimately be empty here even though
  // outstandingBeforeThisChunk > 0 — every currently-outstanding row might be
  // "claimed" by a different concurrent invocation right now.
  let claimedRows: { id: string; contactId: string }[] = [];
  if (candidateRows.length > 0) {
    const candidateIds = candidateRows.map((r) => r.id);
    const claimToken = nanoid();
    await db
      .update(sourcingRuleRunTargets)
      .set({ status: "claimed", error: claimToken, claimedAt: new Date().toISOString() })
      .where(and(inArray(sourcingRuleRunTargets.id, candidateIds), eq(sourcingRuleRunTargets.status, "pending")));

    claimedRows = await db
      .select({ id: sourcingRuleRunTargets.id, contactId: sourcingRuleRunTargets.contactId })
      .from(sourcingRuleRunTargets)
      .where(
        and(
          inArray(sourcingRuleRunTargets.id, candidateIds),
          eq(sourcingRuleRunTargets.status, "claimed"),
          eq(sourcingRuleRunTargets.error, claimToken),
        ),
      );
  }

  const personaRowsForScoring = await loadScorablePersonas(getSharedDb());

  // Scoring and everything that depends on it is wrapped so a single
  // contact's bad AI response or a CommonRoom lookup failure can't abort any
  // other contact in this chunk.
  async function scoreAndLinkTarget(target: { id: string; contactId: string }): Promise<void> {
    try {
      const contactRows = await db
        .select({
          id: contacts.id,
          name: contacts.name,
          title: contacts.title,
          company: contacts.company,
          country: contacts.country,
          employees: contacts.employees,
          hubspotBreezeFitScore: contacts.hubspotBreezeFitScore,
          apolloCompanyFitScore: contacts.apolloCompanyFitScore,
          apolloIntentScore: contacts.apolloIntentScore,
          apolloTitle: contacts.apolloTitle,
          apolloSeniority: contacts.apolloSeniority,
        })
        .from(contacts)
        .where(eq(contacts.id, target.contactId))
        .limit(1);
      const contact = contactRows[0];
      if (!contact) {
        await db
          .update(sourcingRuleRunTargets)
          .set({ status: "errored", error: `Contact ${target.contactId} no longer exists.` })
          .where(eq(sourcingRuleRunTargets.id, target.id));
        return;
      }

      const score = await scoreContactAgainstPersonas({
        contact: {
          name: contact.name,
          title: contact.title,
          company: contact.company,
          country: contact.country,
          employees: contact.employees,
          hubspotBreezeFitScore: contact.hubspotBreezeFitScore,
          apolloCompanyFitScore: contact.apolloCompanyFitScore,
          apolloIntentScore: contact.apolloIntentScore,
          apolloTitle: contact.apolloTitle,
          apolloSeniority: contact.apolloSeniority,
        },
        personas: personaRowsForScoring,
        userEmail: ownerEmail,
        orgId,
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
          apolloCompanyFitScore: score.apolloCompanyFitScore,
          apolloIntentScore: score.apolloIntentScore,
          overallScore: score.overallScore,
          scoreReasoning: score.reasoning,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(contacts.id, target.contactId));

      const existingLink = await db
        .select({ id: segmentContacts.id })
        .from(segmentContacts)
        .where(and(eq(segmentContacts.segmentId, segmentId), eq(segmentContacts.contactId, target.contactId)))
        .limit(1);
      if (!existingLink[0]) {
        await db.insert(segmentContacts).values({ id: nanoid(), segmentId, contactId: target.contactId });
      }

      await db
        .update(sourcingRuleRunTargets)
        .set({ status: "scored", error: null })
        .where(eq(sourcingRuleRunTargets.id, target.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Still link the contact into the segment even when scoring failed —
      // best-effort, a failure here doesn't matter for the pipeline's
      // overall outcome.
      try {
        const existingLink = await db
          .select({ id: segmentContacts.id })
          .from(segmentContacts)
          .where(and(eq(segmentContacts.segmentId, segmentId), eq(segmentContacts.contactId, target.contactId)))
          .limit(1);
        if (!existingLink[0]) {
          await db.insert(segmentContacts).values({ id: nanoid(), segmentId, contactId: target.contactId });
        }
      } catch {
        // best-effort, ignore
      }
      await db
        .update(sourcingRuleRunTargets)
        .set({ status: "errored", error: message })
        .where(eq(sourcingRuleRunTargets.id, target.id));
    }
  }

  // Pay the LeadScore-id resolution cost ONCE, sequentially, before the
  // concurrent batch loop below — not per-contact. Without this, every
  // contact in a batch races to resolve it while the cache is cold, each
  // independently paying the same ~20s MCP round-trip, which stacked on top
  // of scoreContactAgainstPersonas' own bounded completeText() call could
  // push a single batch's worst case close to the platform's function
  // timeout. Best-effort — a failure here just means scoring falls back to
  // resolving the cache per-contact, never a reason to fail the run.
  if (claimedRows.length > 0) {
    try {
      await warmLeadScoreIdCache(orgId);
    } catch {
      // best-effort, ignore
    }
  }

  // Bounded-concurrency batches over only the rows THIS invocation genuinely
  // claimed (may be fewer than candidateRows.length if a concurrent
  // invocation won some of them first). SCORING_CHUNK_SIZE/CONCURRENCY_LIMIT
  // bound batch COUNT, not wall-clock time — a slow (not failing) contact
  // can still blow the platform's function timeout well within that cap, so
  // this checks the time budget before starting each new batch; unprocessed
  // rows stay "claimed" and CLAIM_STALE_AFTER_MS above reclaims them on a
  // later invocation, so no work is lost, just deferred.
  for (let i = 0; i < claimedRows.length; i += CONCURRENCY_LIMIT) {
    if (!withinTimeBudget(invocationStartedAt, SCORING_TIME_BUDGET_MS)) {
      break;
    }
    const batch = claimedRows.slice(i, i + CONCURRENCY_LIMIT);
    await Promise.allSettled(batch.map((target) => scoreAndLinkTarget(target)));
  }

  return await readCurrentCounts(db, syncRecordId);
}

async function readCurrentCounts(db: Db, syncRecordId: string): Promise<ScoringBatchResult> {
  const [scoredCountRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(sourcingRuleRunTargets)
    .where(and(eq(sourcingRuleRunTargets.syncRecordId, syncRecordId), eq(sourcingRuleRunTargets.status, "scored")));
  const [erroredCountRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(sourcingRuleRunTargets)
    .where(and(eq(sourcingRuleRunTargets.syncRecordId, syncRecordId), eq(sourcingRuleRunTargets.status, "errored")));
  // "pending" OR "claimed" — same "outstanding" definition as above: a
  // concurrent invocation could still be mid-processing a claimed batch
  // right now, and that work isn't done just because it isn't "pending"
  // anymore.
  const [outstandingAfterCountRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(sourcingRuleRunTargets)
    .where(
      and(eq(sourcingRuleRunTargets.syncRecordId, syncRecordId), inArray(sourcingRuleRunTargets.status, ["pending", "claimed"])),
    );
  const errorRows = await db
    .select({ error: sourcingRuleRunTargets.error })
    .from(sourcingRuleRunTargets)
    .where(and(eq(sourcingRuleRunTargets.syncRecordId, syncRecordId), eq(sourcingRuleRunTargets.status, "errored")));

  return {
    scored: Number(scoredCountRow?.count ?? 0),
    scoringErrorCount: Number(erroredCountRow?.count ?? 0),
    remaining: Number(outstandingAfterCountRow?.count ?? 0),
    scoringErrors: errorRows.map((r) => r.error).filter((e): e is string => !!e),
  };
}
