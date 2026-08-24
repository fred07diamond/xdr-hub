import { defineAction } from "@agent-native/core";
import { and, desc, eq, sql } from "@agent-native/core/db/schema";
import { resourceGetByPath, resourcePut } from "@agent-native/core/resources";
import { getSharedDb, hubspotFetchWithTimeout, sharedPersonas } from "@xdr-hub/shared/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { contacts, marketingRules, segments, sourcingRuleRunTargets, syncRecords } from "../server/db/schema.js";
import { logAnalyticsEvent } from "../server/helpers/analytics.js";
import { DEFAULT_LIFECYCLE_STAGES, type HubSpotContactRecord } from "../server/helpers/hubspot-contact-properties.js";
import { searchHubSpotContacts } from "../server/helpers/hubspot-contact-search.js";
import { SEARCH_TIME_BUDGET_MS, withinTimeBudget } from "../server/helpers/invocation-budget.js";
import { findCrossSourceMatch } from "../server/helpers/resolve-contact-dedup.js";
import { requireRole } from "../server/helpers/require-role.js";
import { unionWithOwnerScopedCompanies } from "../server/helpers/resolve-owner-scoped-companies.js";
import { runScoringBatch } from "../server/helpers/scoring-chunk.js";
import { assertSegmentWritable } from "../server/helpers/segment-access.js";
import {
  backfillJobOrgId,
  buildRunContinuationJobContent,
  runContinuationJobName,
} from "../server/helpers/sourcing-rule-jobs.js";

// ── Resumable, chunked execution — the HubSpot-lifecycle-stage analog of
// run-sourcing-rule-pipeline.ts (see that file's own top comment for the
// full "why resumable/chunked" reasoning; the same platform function-timeout
// constraint applies here identically). Two real differences from the
// Prospector pipeline:
//
//   1. No target volume. A lifecycle-stage filter over one HubSpot portal's
//      contacts is a bounded, finite pool — the point of a Marketing run is
//      "sync every currently-qualifying contact," not "find N new ones."
//      The search phase's only stop conditions are the per-invocation page
//      cap/time budget (checkpoint, resume later) or HubSpot genuinely
//      saying there's no more (done).
//   2. No LLM-derived filter step. The filter is just the rule's configured
//      lifecycle-stage set plus an optional company allow/deny list — there
//      is nothing to auto-derive, so this pipeline's fresh-start preamble
//      has no completeText() call and thus no preamble-hang risk on the
//      search side (scoring still calls the LLM, unchanged, via the shared
//      runScoringBatch helper — see scoring-chunk.ts).
//
// Same two phases as the Prospector pipeline, tracked in
// sync_records.metadata.phase ("searching" / "scoring"), same per-page
// immediate resolve/dedupe/queue discipline, same durable work-queue table
// (sourcing_rule_run_targets — already rule-agnostic, shared as-is).
const MAX_SEARCH_PAGES_PER_INVOCATION = 4;
// HubSpot's Search API page-size ceiling (matches sync-hubspot.ts's own
// PAGE_SIZE) — a plain HTTPS POST to HubSpot's REST API, not an MCP
// round-trip, so there's no evidence it needs CommonRoom's much smaller
// SEARCH_PAGE_SIZE=25 (that cap exists specifically because of CommonRoom's
// own observed latency, not a generic "small pages are safer" rule).
const SEARCH_PAGE_SIZE = 100;

// Same threshold and reasoning as run-sourcing-rule-pipeline.ts's own
// RUN_STALE_AFTER_MS / lists.tsx's deriveRunStatus.
const RUN_STALE_AFTER_MS = 6 * 60_000;

interface PipelineResult {
  done: boolean;
  syncRecordId: string;
  phase: "searching" | "scoring" | "complete";
  recordsFound: number;
  scored: number;
  remaining: number;
  imported: number;
  deduped: number;
  alreadyKnown: number;
  scoringErrors: string[];
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Same cross-dialect unique-constraint detection as run-sourcing-rule-
// pipeline.ts's own isUniqueConstraintError — see that file's comment for
// the full reasoning (this catches the same TOCTOU race on
// sync_records_running_per_rule_idx, just scoped to marketing_rule_id runs).
function isUniqueConstraintError(err: unknown): boolean {
  const code = String((err as { code?: unknown } | null)?.code ?? "");
  const message = String((err as { message?: unknown } | null)?.message ?? err)
    .toLowerCase()
    .trim();
  return code === "23505" || code === "2067" || message.includes("unique constraint") || message.includes("duplicate key");
}

export default defineAction({
  description:
    "Run (or resume) a Marketing rule's HubSpot-lifecycle-stage pipeline: search HubSpot contacts matching the rule's configured lifecycle stages, upsert + score + segment-link every match, and log the sync run. Resumable and chunked — a single invocation does ONE bounded unit of work and returns {done: false, syncRecordId, ...} if more remains; the caller passes that syncRecordId back in to continue the SAME run instead of starting a new one. Pass no syncRecordId to start a fresh run (or attach to an already-in-progress one for this rule).",
  schema: z.object({ ruleId: z.string().min(1), syncRecordId: z.string().nullish() }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ ruleId, syncRecordId: requestedSyncRecordId }, ctx) => {
    const invocationStartedAt = Date.now();
    const role = await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    const ruleRows = await db.select().from(marketingRules).where(eq(marketingRules.id, ruleId)).limit(1);
    const rule = ruleRows[0];
    if (!rule) {
      throw Object.assign(new Error(`Marketing rule ${ruleId} not found.`), { statusCode: 404 });
    }

    if (rule.ownerEmail !== ctx!.userEmail! && role !== "admin") {
      throw Object.assign(new Error("Only the marketing rule's owner or a manager can run this rule's pipeline."), {
        statusCode: 403,
      });
    }

    // Self-heal rules whose job resource predates orgId being written at
    // creation time — same reasoning as run-sourcing-rule-pipeline.ts's own
    // backfillJobOrgId call.
    if (ctx?.orgId && rule.jobResourcePath) {
      try {
        const jobResource = await resourceGetByPath(rule.ownerEmail, rule.jobResourcePath);
        if (jobResource) {
          const patched = backfillJobOrgId(jobResource.content, ctx.orgId);
          if (patched !== jobResource.content) {
            await resourcePut(rule.ownerEmail, rule.jobResourcePath, patched, jobResource.mimeType);
          }
        }
      } catch {
        // best-effort, ignore
      }
    }

    // ── Resolve which sync_records row this invocation continues — same
    // three-case resolution as run-sourcing-rule-pipeline.ts, scoped to
    // marketing_rule_id instead of sourcing_rule_id.
    let syncRecordId: string;
    let runMetadata: Record<string, unknown>;
    let isFreshStart = false;

    if (requestedSyncRecordId) {
      const rows = await db
        .select({ id: syncRecords.id, marketingRuleId: syncRecords.marketingRuleId, status: syncRecords.status, metadata: syncRecords.metadata })
        .from(syncRecords)
        .where(eq(syncRecords.id, requestedSyncRecordId))
        .limit(1);
      const row = rows[0];
      if (!row || row.marketingRuleId !== ruleId || row.status !== "running") {
        throw Object.assign(
          new Error(`Sync record ${requestedSyncRecordId} is not a resumable, in-progress run for rule ${ruleId}.`),
          { statusCode: 404 },
        );
      }
      syncRecordId = row.id;
      runMetadata = parseMetadata(row.metadata);
    } else {
      const runningRows = await db
        .select({ id: syncRecords.id, startedAt: syncRecords.startedAt, metadata: syncRecords.metadata })
        .from(syncRecords)
        .where(and(eq(syncRecords.marketingRuleId, ruleId), eq(syncRecords.status, "running")))
        .orderBy(desc(syncRecords.startedAt))
        .limit(1);
      const runningRow = runningRows[0];
      const startedMs = runningRow?.startedAt ? new Date(runningRow.startedAt).getTime() : NaN;
      const isStale = !Number.isNaN(startedMs) && Date.now() - startedMs > RUN_STALE_AFTER_MS;

      if (runningRow && !isStale) {
        syncRecordId = runningRow.id;
        runMetadata = parseMetadata(runningRow.metadata);
      } else {
        if (runningRow && isStale) {
          await db
            .update(syncRecords)
            .set({
              status: "failed",
              completedAt: new Date().toISOString(),
              error: "Run abandoned — exceeded execution window without completing.",
            })
            .where(eq(syncRecords.id, runningRow.id));
          try {
            await db.delete(sourcingRuleRunTargets).where(eq(sourcingRuleRunTargets.syncRecordId, runningRow.id));
          } catch {
            // best-effort, ignore
          }
        }

        isFreshStart = true;

        const personaRow = await getSharedDb().select({ id: sharedPersonas.id }).from(sharedPersonas).where(eq(sharedPersonas.id, rule.personaId)).limit(1);
        if (!personaRow[0]) {
          throw Object.assign(new Error(`Persona ${rule.personaId} not found.`), { statusCode: 404 });
        }

        await assertSegmentWritable(rule.segmentId, rule.ownerEmail, db);

        const candidateSyncRecordId = nanoid();
        const runStartedAt = new Date().toISOString();
        try {
          await db.insert(syncRecords).values({
            id: candidateSyncRecordId,
            source: "hubspot",
            marketingRuleId: ruleId,
            startedAt: runStartedAt,
            completedAt: null,
            recordsPulled: null,
            status: "running",
            metadata: JSON.stringify({
              marketingRuleId: ruleId,
              phase: "searching",
              searchCursor: null,
              recordsFound: 0,
            }),
          });
          syncRecordId = candidateSyncRecordId;
          runMetadata = { phase: "searching" };

          if (ctx?.caller === "frontend") {
            try {
              await resourcePut(
                rule.ownerEmail,
                `jobs/${runContinuationJobName(ruleId)}.md`,
                buildRunContinuationJobContent({
                  ruleId,
                  syncRecordId: candidateSyncRecordId,
                  createdBy: rule.ownerEmail,
                  orgId: ctx?.orgId,
                  actionName: "run-marketing-rule-pipeline",
                  ruleLabel: "marketing-rule",
                }),
                "text/markdown",
              );
            } catch {
              // best-effort, ignore
            }
          }
        } catch (err) {
          if (!isUniqueConstraintError(err)) throw err;
          const winnerRows = await db
            .select({ id: syncRecords.id, metadata: syncRecords.metadata })
            .from(syncRecords)
            .where(and(eq(syncRecords.marketingRuleId, ruleId), eq(syncRecords.status, "running")))
            .orderBy(desc(syncRecords.startedAt))
            .limit(1);
          const winner = winnerRows[0];
          if (!winner) {
            throw Object.assign(
              new Error("Another run just started for this rule but couldn't be found to attach to — please try again."),
              { statusCode: 409 },
            );
          }
          isFreshStart = false;
          syncRecordId = winner.id;
          runMetadata = parseMetadata(winner.metadata);
        }
      }
    }

    try {
      return await runPipelineBody();
    } catch (err) {
      await db
        .update(syncRecords)
        .set({
          status: "failed",
          completedAt: new Date().toISOString(),
          error: err instanceof Error ? err.message : String(err),
        })
        .where(eq(syncRecords.id, syncRecordId));
      try {
        await db.delete(sourcingRuleRunTargets).where(eq(sourcingRuleRunTargets.syncRecordId, syncRecordId));
      } catch {
        // best-effort, ignore
      }
      throw err;
    }

    async function runPipelineBody(): Promise<PipelineResult> {
      if (isFreshStart) {
        return await startFreshAndSearch();
      }
      if (runMetadata.phase === "scoring") {
        return await runScoringChunk();
      }
      return await resumeSearching();
    }

    async function startFreshAndSearch(): Promise<PipelineResult> {
      const parsedLifecycleStages: string[] | null = rule.lifecycleStages ? JSON.parse(rule.lifecycleStages) : null;
      const lifecycleStages: string[] =
        parsedLifecycleStages && parsedLifecycleStages.length > 0 ? parsedLifecycleStages : DEFAULT_LIFECYCLE_STAGES;
      const staticAllowList: string[] | null = rule.companyAllowList ? JSON.parse(rule.companyAllowList) : null;
      const staticDenyList: string[] | null = rule.companyDenyList ? JSON.parse(rule.companyDenyList) : null;
      // Live-resolved once per fresh run start, then cached into
      // syncRecords.metadata via runSearchRound below so a resumed/chunked
      // continuation of THIS run doesn't re-resolve mid-run -- the next
      // scheduled run picks up any book changes.
      const [companyAllowList, companyDenyList] = await Promise.all([
        unionWithOwnerScopedCompanies(staticAllowList, rule.companyAllowListOwnerId),
        unionWithOwnerScopedCompanies(staticDenyList, rule.companyDenyListOwnerId),
      ]);

      return await runSearchRound({
        cursor: undefined,
        recordsFoundSoFar: 0,
        importedSoFar: 0,
        dedupedSoFar: 0,
        alreadyKnownSoFar: 0,
        lifecycleStages,
        companyAllowList,
        companyDenyList,
      });
    }

    async function resumeSearching(): Promise<PipelineResult> {
      const meta = runMetadata;
      const cursor = (meta.searchCursor as string | null | undefined) ?? undefined;
      const recordsFoundSoFar = (meta.recordsFound as number | undefined) ?? 0;
      const importedSoFar = (meta.imported as number | undefined) ?? 0;
      const dedupedSoFar = (meta.deduped as number | undefined) ?? 0;
      const alreadyKnownSoFar = (meta.alreadyKnown as number | undefined) ?? 0;
      const lifecycleStages = (meta.lifecycleStages as string[] | undefined) ?? DEFAULT_LIFECYCLE_STAGES;
      const companyAllowList = (meta.companyAllowList as string[] | null | undefined) ?? undefined;
      const companyDenyList = (meta.companyDenyList as string[] | null | undefined) ?? undefined;

      return await runSearchRound({
        cursor,
        recordsFoundSoFar,
        importedSoFar,
        dedupedSoFar,
        alreadyKnownSoFar,
        lifecycleStages,
        companyAllowList,
        companyDenyList,
      });
    }

    async function runSearchRound(params: {
      cursor: string | undefined;
      recordsFoundSoFar: number;
      importedSoFar: number;
      dedupedSoFar: number;
      alreadyKnownSoFar: number;
      lifecycleStages: string[];
      companyAllowList: string[] | undefined;
      companyDenyList: string[] | undefined;
    }): Promise<PipelineResult> {
      let cursor = params.cursor;
      let recordsFound = params.recordsFoundSoFar;
      let imported = params.importedSoFar;
      let deduped = params.dedupedSoFar;
      let alreadyKnown = params.alreadyKnownSoFar;
      let searchDone = false;
      const now = new Date().toISOString();

      // Portal ID for constructing direct HubSpot contact links (best-effort,
      // same as sync-hubspot.ts) — cheap enough to just re-fetch each
      // invocation rather than threading it through metadata.
      let portalId: number | null = null;
      try {
        const info = (await hubspotFetchWithTimeout("/account-info/v3/details")) as { portalId?: number };
        portalId = info.portalId ?? null;
      } catch {
        // best-effort
      }

      for (let page = 0; page < MAX_SEARCH_PAGES_PER_INVOCATION; page++) {
        if (!withinTimeBudget(invocationStartedAt, SEARCH_TIME_BUDGET_MS)) {
          break;
        }

        const pageResult = await searchHubSpotContacts({
          lifecycleStages: params.lifecycleStages,
          companyAllowList: params.companyAllowList,
          companyDenyList: params.companyDenyList,
          limit: SEARCH_PAGE_SIZE,
          cursor,
        });

        recordsFound += pageResult.records.length;

        for (const record of pageResult.records) {
          const p = record.properties;
          const name = [p.firstname, p.lastname].filter(Boolean).join(" ").trim();
          if (!name) continue; // nothing useful to sort, matches sync-hubspot.ts

          const { resolutionKind } = await resolveHubSpotContact(record, name, portalId, now);
          if (resolutionKind === "deduped") deduped++;
          else if (resolutionKind === "alreadyKnown") alreadyKnown++;
          else imported++;
        }

        cursor = pageResult.nextCursor;

        // Genuinely exhausted — HubSpot says no more (or gave no cursor to
        // continue with even though hasMore claimed otherwise, same
        // defensive fallback as the Prospector pipeline).
        if (!pageResult.hasMore || !cursor) {
          searchDone = true;
          break;
        }
      }

      if (!searchDone) {
        await db
          .update(syncRecords)
          .set({
            metadata: JSON.stringify({
              marketingRuleId: ruleId,
              phase: "searching",
              searchCursor: cursor ?? null,
              recordsFound,
              imported,
              deduped,
              alreadyKnown,
              lifecycleStages: params.lifecycleStages,
              companyAllowList: params.companyAllowList ?? null,
              companyDenyList: params.companyDenyList ?? null,
            }),
          })
          .where(eq(syncRecords.id, syncRecordId));

        return {
          done: false,
          syncRecordId,
          phase: "searching",
          recordsFound,
          scored: 0,
          remaining: 0,
          imported,
          deduped,
          alreadyKnown,
          scoringErrors: [],
        };
      }

      if (recordsFound === 0) {
        return await finishRun({ recordsFound: 0, imported: 0, deduped: 0, alreadyKnown: 0, lifecycleStages: params.lifecycleStages });
      }

      const [pendingCountRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(sourcingRuleRunTargets)
        .where(and(eq(sourcingRuleRunTargets.syncRecordId, syncRecordId), eq(sourcingRuleRunTargets.status, "pending")));
      const pendingCount = Number(pendingCountRow?.count ?? 0);

      await db
        .update(syncRecords)
        .set({
          metadata: JSON.stringify({
            marketingRuleId: ruleId,
            phase: "scoring",
            recordsFound,
            imported,
            deduped,
            alreadyKnown,
            scored: 0,
            scoringErrorCount: 0,
            lifecycleStages: params.lifecycleStages,
          }),
        })
        .where(eq(syncRecords.id, syncRecordId));

      return {
        done: false,
        syncRecordId,
        phase: "scoring",
        recordsFound,
        scored: 0,
        remaining: pendingCount,
        imported,
        deduped,
        alreadyKnown,
        scoringErrors: [],
      };
    }

    // Same existing-check/dedup/insert-or-update decision as
    // run-sourcing-rule-pipeline.ts's resolveContact, adapted for a HubSpot
    // Search API record instead of a Prospector match.
    async function resolveHubSpotContact(
      record: HubSpotContactRecord,
      name: string,
      portalId: number | null,
      now: string,
    ): Promise<{ contactId: string; resolutionKind: "imported" | "deduped" | "alreadyKnown" }> {
      const p = record.properties;
      const hubspotUrl = portalId ? `https://app.hubspot.com/contacts/${portalId}/contact/${record.id}` : null;
      const lifecycleStage = p.lifecyclestage ?? null;

      const rawQlScore = p.ql_score != null && p.ql_score !== "" ? Number(p.ql_score) : NaN;
      const hubspotQlScore = Number.isFinite(rawQlScore) ? Math.max(0, Math.min(100, Math.round(rawQlScore))) : null;
      const rawBreezeFit =
        p.company_fit_score___breeze != null && p.company_fit_score___breeze !== "" ? Number(p.company_fit_score___breeze) : NaN;
      const hubspotBreezeFitScore = Number.isFinite(rawBreezeFit)
        ? Math.max(0, Math.min(100, Math.round((rawBreezeFit / 20) * 100)))
        : null;

      const existing = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.externalId, record.id), eq(contacts.source, "hubspot")))
        .limit(1);

      let contactId: string;
      let resolutionKind: "imported" | "deduped" | "alreadyKnown" = "alreadyKnown";
      if (existing[0]) {
        contactId = existing[0].id;
        await db
          .update(contacts)
          .set({
            name,
            title: p.jobtitle ?? null,
            company: p.company ?? null,
            email: p.email ?? null,
            phone: p.phone ?? null,
            linkedinUrl: p.hs_linkedin_url ?? null,
            hubspotUrl,
            lifecycleStage,
            hubspotQlScore,
            hubspotBreezeFitScore,
            syncedAt: now,
            updatedAt: now,
          })
          .where(eq(contacts.id, contactId));
      } else {
        const crossSourceMatch = await findCrossSourceMatch(db, {
          email: p.email ?? null,
          linkedinUrl: p.hs_linkedin_url ?? null,
        });

        if (crossSourceMatch) {
          // Belongs to a different sync pipeline that owns its own
          // field-refresh cadence — don't create a duplicate row and don't
          // touch its existing fields.
          contactId = crossSourceMatch.id;
          resolutionKind = "deduped";
        } else {
          contactId = nanoid();
          resolutionKind = "imported";
          await db.insert(contacts).values({
            id: contactId,
            name,
            title: p.jobtitle ?? null,
            company: p.company ?? null,
            email: p.email ?? null,
            phone: p.phone ?? null,
            linkedinUrl: p.hs_linkedin_url ?? null,
            hubspotUrl,
            lifecycleStage,
            hubspotQlScore,
            hubspotBreezeFitScore,
            source: "hubspot",
            externalId: record.id,
            status: "active",
            syncedAt: now,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      // onConflictDoNothing guards the same v30 UNIQUE(sync_record_id,
      // contact_id) index the Prospector pipeline relies on.
      await db
        .insert(sourcingRuleRunTargets)
        .values({ id: nanoid(), syncRecordId, contactId, status: "pending" })
        .onConflictDoNothing();

      return { contactId, resolutionKind };
    }

    async function runScoringChunk(): Promise<PipelineResult> {
      const currentMetaRows = await db
        .select({ metadata: syncRecords.metadata })
        .from(syncRecords)
        .where(eq(syncRecords.id, syncRecordId))
        .limit(1);
      const currentMeta = parseMetadata(currentMetaRows[0]?.metadata ?? null);
      const recordsFound = (currentMeta.recordsFound as number | undefined) ?? 0;
      const imported = (currentMeta.imported as number | undefined) ?? 0;
      const deduped = (currentMeta.deduped as number | undefined) ?? 0;
      const alreadyKnown = (currentMeta.alreadyKnown as number | undefined) ?? 0;
      const lifecycleStages = (currentMeta.lifecycleStages as string[] | undefined) ?? null;

      const batch = await runScoringBatch({
        db,
        syncRecordId,
        segmentId: rule.segmentId,
        ownerEmail: rule.ownerEmail,
        orgId: ctx?.orgId,
        invocationStartedAt,
      });

      if (batch.remaining === 0) {
        return await finishRun({ recordsFound, imported, deduped, alreadyKnown, lifecycleStages });
      }

      await db
        .update(syncRecords)
        .set({
          metadata: JSON.stringify({
            marketingRuleId: ruleId,
            phase: "scoring",
            recordsFound,
            imported,
            deduped,
            alreadyKnown,
            scored: batch.scored,
            scoringErrorCount: batch.scoringErrorCount,
            lifecycleStages,
          }),
        })
        .where(eq(syncRecords.id, syncRecordId));

      return {
        done: false,
        syncRecordId,
        phase: "scoring",
        recordsFound,
        scored: batch.scored,
        remaining: batch.remaining,
        imported,
        deduped,
        alreadyKnown,
        scoringErrors: batch.scoringErrors,
      };
    }

    async function finishRun(counts: {
      recordsFound: number;
      imported: number;
      deduped: number;
      alreadyKnown: number;
      lifecycleStages?: string[] | null;
    }): Promise<PipelineResult> {
      const scoredRows = await db
        .select({ id: sourcingRuleRunTargets.id })
        .from(sourcingRuleRunTargets)
        .where(and(eq(sourcingRuleRunTargets.syncRecordId, syncRecordId), eq(sourcingRuleRunTargets.status, "scored")));
      const erroredRows = await db
        .select({ error: sourcingRuleRunTargets.error })
        .from(sourcingRuleRunTargets)
        .where(and(eq(sourcingRuleRunTargets.syncRecordId, syncRecordId), eq(sourcingRuleRunTargets.status, "errored")));

      const scored = scoredRows.length;
      const scoringErrorCount = erroredRows.length;
      const scoringErrors = erroredRows.map((r) => r.error).filter((e): e is string => !!e);

      const completedAt = new Date().toISOString();
      await db
        .update(syncRecords)
        .set({
          completedAt,
          status: "success",
          recordsPulled: counts.recordsFound,
          metadata: JSON.stringify({
            marketingRuleId: ruleId,
            scoringErrorCount,
            deduped: counts.deduped,
            alreadyKnown: counts.alreadyKnown,
            lifecycleStages: counts.lifecycleStages ?? null,
            phase: "complete",
            recordsFound: counts.recordsFound,
            imported: counts.imported,
            scored,
          }),
        })
        .where(eq(syncRecords.id, syncRecordId));

      await db.delete(sourcingRuleRunTargets).where(eq(sourcingRuleRunTargets.syncRecordId, syncRecordId));

      await db.update(segments).set({ lastRefreshedAt: completedAt }).where(eq(segments.id, rule.segmentId));

      await logAnalyticsEvent(rule.ownerEmail, "sync_run", {
        source: "hubspot",
        status: "success",
        recordsPulled: counts.recordsFound,
        marketingRuleId: ruleId,
        scoringErrorCount,
        deduped: counts.deduped,
        alreadyKnown: counts.alreadyKnown,
      });

      return {
        done: true,
        syncRecordId,
        phase: "complete",
        recordsFound: counts.recordsFound,
        scored,
        remaining: 0,
        imported: counts.imported,
        deduped: counts.deduped,
        alreadyKnown: counts.alreadyKnown,
        scoringErrors,
      };
    }
  },
});
