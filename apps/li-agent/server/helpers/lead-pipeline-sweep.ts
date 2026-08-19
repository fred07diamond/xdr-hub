import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { leadLists, leadListItems } from "../db/schema.js";
import { enrichLeadListItem } from "./enrich-lead-list-item.js";
import { scoreLeadListItem } from "./score-lead-list-item.js";

type Db = ReturnType<typeof getDb>;

// Batch size + time budget per tick -- the sweep is invoked from request
// middleware (see server/middleware/lead-pipeline-sweep.ts), so a tick must
// stay comfortably inside both the app's function timeout and the
// framework's own keep-warm health-check fetch timeout (25s) so a slow tick
// never makes an unrelated request look like a health failure.
const BATCH_SIZE = 5;
const TICK_BUDGET_MS = 20_000;

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
    .where(and(eq(leadListItems.enrichmentStatus, "enriching"), lt(leadListItems.updatedAt, staleCutoff)));

  const retryable = stale.filter((r) => r.pipelineAttempts < MAX_ATTEMPTS).map((r) => r.id);
  const exhausted = stale.filter((r) => r.pipelineAttempts >= MAX_ATTEMPTS).map((r) => r.id);

  if (retryable.length > 0) {
    await db
      .update(leadListItems)
      .set({ enrichmentStatus: "idle", updatedAt: now })
      .where(inArray(leadListItems.id, retryable));
  }
  if (exhausted.length > 0) {
    await db
      .update(leadListItems)
      .set({ enrichmentStatus: "failed", enrichmentError: "Auto-pipeline gave up after 3 attempts.", updatedAt: now })
      .where(inArray(leadListItems.id, exhausted));
  }
}

async function timeoutStalePhoneReveals(db: Db): Promise<void> {
  const staleCutoff = isoMinutesAgo(PHONE_REVEAL_STALE_MS);
  await db
    .update(leadListItems)
    .set({ phoneRevealStatus: "failed", updatedAt: new Date().toISOString() })
    .where(and(eq(leadListItems.phoneRevealStatus, "requested"), lt(leadListItems.phoneRevealRequestedAt, staleCutoff)));
}

async function claimBatch(db: Db) {
  const candidates = await db
    .select()
    .from(leadListItems)
    .where(and(
      eq(leadListItems.autoEnrich, 1),
      eq(leadListItems.enrichmentStatus, "idle"),
      isNull(leadListItems.promotedProspectId),
    ))
    .orderBy(leadListItems.createdAt)
    .limit(BATCH_SIZE);

  if (candidates.length === 0) return [];

  const now = new Date().toISOString();
  const ids = candidates.map((c) => c.id);
  await db
    .update(leadListItems)
    .set({ enrichmentStatus: "enriching", updatedAt: now })
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

    const batch = await claimBatch(db);
    const ownerEmailByListId = new Map<string, string | null>();
    for (const item of batch) {
      if (Date.now() - startedAt > TICK_BUDGET_MS) break;
      try {
        await enrichLeadListItem(db, item);
        // Re-select: enrichLeadListItem already wrote the enrichment
        // columns to the row -- scoreLeadListItem needs those fresh values
        // (e.g. enrichedLinkedinUrl), not the pre-enrichment snapshot.
        const [freshItem] = await db.select().from(leadListItems).where(eq(leadListItems.id, item.id));
        if (!freshItem) continue;

        if (!ownerEmailByListId.has(item.listId)) {
          const [list] = await db.select({ ownerEmail: leadLists.ownerEmail }).from(leadLists).where(eq(leadLists.id, item.listId));
          ownerEmailByListId.set(item.listId, list?.ownerEmail ?? null);
        }
        const ownerEmail = ownerEmailByListId.get(item.listId) ?? null;

        const scored = await scoreLeadListItem(db, freshItem, ownerEmail);
        if (scored.ok && scored.prospectId) {
          await db
            .update(leadListItems)
            .set({ promotedProspectId: scored.prospectId, updatedAt: new Date().toISOString() })
            .where(eq(leadListItems.id, item.id));
        }
      } catch (err) {
        await db
          .update(leadListItems)
          .set({
            enrichmentStatus: "failed",
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
