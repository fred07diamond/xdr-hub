import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { leadLists, leadListItems, prospects } from "../db/schema.js";
import { AvoidTitleFilter } from "./apollo-credits/avoid-title-filter.js";
import { voidStaleReservations } from "./apollo-credits/ledger.js";
import { getApolloCreditSettings, verdictClearsBar } from "./apollo-credits/settings.js";
import { enrichApolloRecord } from "./enrich-apollo-record.js";
import { promoteLeadListItem, scoreLeadListItem } from "./score-lead-list-item.js";

type Db = ReturnType<typeof getDb>;

// Batch size + time budget per tick -- the sweep is invoked (debounced)
// from request middleware (see server/middleware/lead-pipeline-sweep.ts)
// on REAL incoming requests, since this deployment has no other reliable
// trigger (see that file's comment). Kept small and awaited so it can
// never meaningfully delay whichever real page load/action call happens
// to carry it.
const BATCH_SIZE = 2;
const TICK_BUDGET_MS = 8_000;

// A claimed lead stuck in "enriching" this long (a tick that crashed
// mid-Apollo-call, or the process was recycled) is treated as abandoned and
// retried, up to MAX_ATTEMPTS.
const STALE_CLAIM_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 3;

// Same threshold already established client-side in lead-lists.tsx's
// PHONE_REVEAL_STALE_AFTER_MS -- that constant only ever changed what the
// UI *displayed*, it never persisted the timeout. This makes it real: past
// 5 minutes with no webhook callback, Apollo's reveal is dispositioned as a
// failure so it shows up in Analytics' Phone Reveal "Failed" bucket instead
// of silently vanishing.
const PHONE_REVEAL_STALE_MS = 5 * 60 * 1000;

function isoMinutesAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

// Resets a lead stuck in "enriching" (a tick that crashed mid-Apollo-call,
// or the process was recycled) back to "idle" so it gets retried, unless
// it has already exhausted MAX_ATTEMPTS -- then it's a terminal failure.
async function unclaimRetryableStale(db: Db): Promise<void> {
  const staleCutoff = isoMinutesAgo(STALE_CLAIM_MS);
  const now = new Date().toISOString();
  const stale = await db
    .select({ id: leadListItems.id, pipelineAttempts: leadListItems.pipelineAttempts })
    .from(leadListItems)
    // Any mid-pipeline stage can be abandoned by a recycled process, not just
    // the Apollo call -- scoring is an LLM call that can hang just as easily.
    .where(and(
      inArray(leadListItems.pipelineStage, ["scoring", "enriching", "promoting"]),
      lt(leadListItems.updatedAt, staleCutoff),
    ));

  const retryable = stale.filter((r) => r.pipelineAttempts < MAX_ATTEMPTS).map((r) => r.id);
  const exhausted = stale.filter((r) => r.pipelineAttempts >= MAX_ATTEMPTS).map((r) => r.id);

  if (retryable.length > 0) {
    await db
      .update(leadListItems)
      .set({ pipelineStage: "queued", updatedAt: now })
      .where(inArray(leadListItems.id, retryable));
  }
  if (exhausted.length > 0) {
    await db
      .update(leadListItems)
      .set({
        pipelineStage: "failed",
        enrichmentError: "Auto-pipeline gave up after 3 attempts.",
        updatedAt: now,
      })
      .where(inArray(leadListItems.id, exhausted));
  }
}

async function timeoutStalePhoneReveals(db: Db): Promise<void> {
  const staleCutoff = isoMinutesAgo(PHONE_REVEAL_STALE_MS);
  const now = new Date().toISOString();
  await db
    .update(leadListItems)
    .set({ phoneRevealStatus: "failed", updatedAt: now })
    .where(and(eq(leadListItems.phoneRevealStatus, "requested"), lt(leadListItems.phoneRevealRequestedAt, staleCutoff)));
  // Prospects too. This only covered lead_list_items, so a prospect's reveal
  // could sit "requested" forever -- showing "Revealing..." in the UI
  // indefinitely, never reaching Analytics' Phone Reveal "Failed" bucket, and
  // (now that reveals cost real money) stranding its 8-credit reservation as
  // pending_webhook so the credits were never released or confirmed.
  await db
    .update(prospects)
    .set({ phoneRevealStatus: "failed", updatedAt: now })
    .where(and(eq(prospects.phoneRevealStatus, "requested"), lt(prospects.phoneRevealRequestedAt, staleCutoff)));
}

async function claimBatch(db: Db) {
  const candidates = await db
    .select()
    .from(leadListItems)
    .where(and(
      eq(leadListItems.autoEnrich, 1),
      // Claim on pipelineStage, not enrichmentStatus: a lead now gets SCORED
      // before it is enriched, so "has Apollo run" is no longer the same
      // question as "is this lead waiting for the pipeline". The attempts
      // guard moves into the predicate too, replacing what the old
      // enrichmentStatus='idle' filter implicitly provided.
      eq(leadListItems.pipelineStage, "queued"),
      lt(leadListItems.pipelineAttempts, MAX_ATTEMPTS),
      isNull(leadListItems.promotedProspectId),
    ))
    .orderBy(leadListItems.createdAt)
    .limit(BATCH_SIZE);

  if (candidates.length === 0) return [];

  const now = new Date().toISOString();
  const ids = candidates.map((c) => c.id);
  await db
    .update(leadListItems)
    .set({ pipelineStage: "scoring", updatedAt: now })
    .where(inArray(leadListItems.id, ids));
  // Increment attempts one row at a time -- drizzle has no portable
  // "SET pipeline_attempts = pipeline_attempts + 1" across both dialects
  // this app can run against without raw SQL per-dialect, and this only
  // runs over a small batch (<= BATCH_SIZE) once per tick.
  for (const c of candidates) {
    await db
      .update(leadListItems)
      .set({ pipelineAttempts: c.pipelineAttempts + 1 })
      .where(eq(leadListItems.id, c.id));
  }

  return candidates.map((c) => ({ ...c, pipelineAttempts: c.pipelineAttempts + 1 }));
}

// One bounded tick of the automatic enrich -> score -> draft -> promote
// pipeline. Called from server/middleware/lead-pipeline-sweep.ts, which
// debounces how often this actually runs. Every step is best-effort per
// lead -- one lead's failure never blocks the rest of the batch, and never
// throws out of this function (a stuck tick would otherwise delay whatever
// request carried it).
export async function runLeadPipelineSweepTick(): Promise<void> {
  const db = getDb();
  const startedAt = Date.now();

  try {
    await unclaimRetryableStale(db);
    await timeoutStalePhoneReveals(db);
    // Release credit reservations abandoned by a process that died between
    // reserving and settling -- they would otherwise consume budget forever.
    // Runs here rather than on a schedule because this deployment has no
    // reliable cron (see server/middleware/lead-pipeline-sweep.ts).
    await voidStaleReservations();

    const settings = await getApolloCreditSettings();
    const avoidFilter = new AvoidTitleFilter();
    const batch = await claimBatch(db);
    const ownerEmailByListId = new Map<string, string | null>();

    for (const item of batch) {
      if (Date.now() - startedAt > TICK_BUDGET_MS) break;
      try {
        const stamp = () => new Date().toISOString();

        // ── 1. FREE prefilter ────────────────────────────────────────────
        // The persona briefing's avoidTitlesSearch is a list of literal job
        // titles the ICP explicitly excludes. Matching a headline against it
        // costs neither an Apollo call nor an LLM call, so it runs before
        // anything billable.
        const avoided = await avoidFilter.matchedAvoidTitle(
          item.personaId,
          item.headline,
          item.enrichedTitle,
        );
        if (avoided) {
          await db
            .update(leadListItems)
            .set({
              pipelineStage: "blocked",
              pipelineBlockedReason: `avoid_title:${avoided}`,
              updatedAt: stamp(),
            })
            .where(eq(leadListItems.id, item.id));
          continue;
        }

        if (!ownerEmailByListId.has(item.listId)) {
          const [list] = await db.select({ ownerEmail: leadLists.ownerEmail }).from(leadLists).where(eq(leadLists.id, item.listId));
          ownerEmailByListId.set(item.listId, list?.ownerEmail ?? null);
        }
        const ownerEmail = ownerEmailByListId.get(item.listId) ?? null;

        // ── 2. SCORE (LLM only, zero Apollo credits) ─────────────────────
        // This is the whole point of the reorder: find out whether a lead is
        // worth a credit BEFORE spending one.
        await scoreLeadListItem(db, item, ownerEmail);
        await db
          .update(leadListItems)
          .set({ pipelineStage: "scored", updatedAt: stamp() })
          .where(eq(leadListItems.id, item.id));

        const [scoredItem] = await db.select().from(leadListItems).where(eq(leadListItems.id, item.id));
        if (!scoredItem) continue;

        // ── 3. GATE, then enrich ─────────────────────────────────────────
        // A lead below the bar is still scored, drafted and promoted -- it is
        // only never AUTO-enriched. The Apollo credit buys contact data, which
        // this app's primary LinkedIn-connection motion doesn't need, and
        // silently dropping such leads would contradict the documented policy
        // that every imported lead is expected to be reached out to. It keeps
        // its per-row Enrich button for explicit user action.
        let enrichBlocked: string | null = null;
        if (verdictClearsBar(scoredItem.fitVerdict, settings.enrichMinVerdict)) {
          await db
            .update(leadListItems)
            .set({ pipelineStage: "enriching", updatedAt: stamp() })
            .where(eq(leadListItems.id, item.id));

          // trigger "sweep" charges the workspace rather than a person and is
          // capped at the sweep's own share of the budget, leaving credits for
          // interactive work. revealPhone stays false: an unattended pass must
          // never spend 8 credits on a number nobody asked for.
          const enriched = await enrichApolloRecord(
            db,
            { kind: "lead_list_item", row: scoredItem },
            { trigger: "sweep", actorEmail: null, revealPhone: false },
          );
          enrichBlocked = enriched.blockedReason ?? null;
        } else {
          enrichBlocked = null;
          await db
            .update(leadListItems)
            .set({ pipelineBlockedReason: `below_quality_bar:${scoredItem.fitVerdict ?? "unscored"}`, updatedAt: stamp() })
            .where(eq(leadListItems.id, item.id));
        }

        // A refused spend is not a lead failure. Return the row to `queued`
        // WITHOUT burning a pipeline attempt, and stop the tick: otherwise a
        // multi-day budget pause would march every queued lead through
        // MAX_ATTEMPTS and mark hundreds of them permanently failed. The
        // scoring work already done is preserved on the row.
        if (enrichBlocked) {
          await db
            .update(leadListItems)
            .set({
              pipelineStage: "queued",
              pipelineBlockedReason: `budget:${enrichBlocked}`,
              pipelineAttempts: Math.max(0, item.pipelineAttempts - 1),
              updatedAt: stamp(),
            })
            .where(eq(leadListItems.id, item.id));
          break;
        }

        // ── 4. PROMOTE ───────────────────────────────────────────────────
        // Re-select so promotion sees the enrichment columns (notably
        // enrichedLinkedinUrl, which is what supplies a real profile URL).
        const [freshItem] = await db.select().from(leadListItems).where(eq(leadListItems.id, item.id));
        if (!freshItem) continue;

        await db
          .update(leadListItems)
          .set({ pipelineStage: "promoting", updatedAt: stamp() })
          .where(eq(leadListItems.id, item.id));

        const promoted = await promoteLeadListItem(db, freshItem, ownerEmail);
        await db
          .update(leadListItems)
          .set({
            // `no_profile_url` is a normal outcome, not a failure: the lead
            // keeps its verdict and draft and waits for a real URL rather
            // than being promoted under a synthetic Sales Nav key that
            // capture-profile.ts could never reconcile.
            pipelineStage: "done",
            ...(promoted.ok && promoted.prospectId ? { promotedProspectId: promoted.prospectId } : {}),
            ...(promoted.code === "no_profile_url"
              ? { pipelineBlockedReason: "awaiting_profile_url" }
              : {}),
            updatedAt: stamp(),
          })
          .where(eq(leadListItems.id, item.id));
      } catch (err) {
        await db
          .update(leadListItems)
          .set({
            // pipelineStage records that the PIPELINE gave up.
            // enrichmentStatus is left alone unless Apollo itself was the
            // thing that failed -- enrichApolloRecord owns that column, and
            // marking it "failed" for, say, a scoring error would put a
            // phantom row in the enrichment audit export for a lead Apollo
            // was never called on.
            pipelineStage: "failed",
            enrichmentError: `Auto-pipeline: ${err instanceof Error ? err.message : String(err)}`,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(leadListItems.id, item.id));
      }
    }
  } catch {
    // Never let a sweep-level failure (e.g. a transient DB hiccup) surface
    // to the request that happened to carry this tick.
  }
}
