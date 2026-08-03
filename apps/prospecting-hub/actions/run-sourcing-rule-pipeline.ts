import { defineAction } from "@agent-native/core";
import { and, desc, eq, or, sql } from "@agent-native/core/db/schema";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import {
  contacts,
  icps,
  libraryDocs,
  personas,
  segmentContacts,
  sourcingRuleRunTargets,
  sourcingRules,
  subPersonas,
  syncRecords,
} from "../server/db/schema.js";
import { logAnalyticsEvent } from "../server/helpers/analytics.js";
import { deriveProspectorFilters } from "../server/helpers/derive-prospector-filters.js";
import { searchIcpCompanies } from "../server/helpers/icp-filters.js";
import { escapeLikePattern, normalizeLinkedinUrl } from "../server/helpers/normalize-linkedin-url.js";
import { searchProspectorContacts, type ProspectorMatch } from "../server/helpers/prospector-client.js";
import { requireRole } from "../server/helpers/require-role.js";
import { scoreContactAgainstPersonas } from "../server/helpers/score-contact.js";
import { assertSegmentWritable } from "../server/helpers/segment-access.js";

// Library-doc categories preferred as grounding context for the persona-
// filter derivation prompt — a simple "prefer these categories" heuristic
// per the task brief, not a relevance-ranking model.
const PREFERRED_GROUNDING_CATEGORIES = new Set(["icp", "persona_messaging"]);
const MAX_GROUNDING_DOCS = 2;
const GROUNDING_DOC_EXCERPT_LENGTH = 3000;

// ── Resumable, chunked execution (raising the volume cap 200 -> 1000) ──────
//
// Scoring 1000 contacts one HTTP request at a time (even with the existing
// 4x scoring concurrency) would take well past any realistic server function
// timeout, and CommonRoom Prospector search itself needs multiple raw pages
// to reach 1000 post-filtered matches. So this action is now a resumable
// state machine: each invocation does exactly ONE bounded unit of work
// (either "fetch a few more search pages" or "score a chunk of already-found
// contacts") and returns a `{done, ...}` progress payload. The caller (the
// "Find prospects now" button in lists.tsx) keeps calling this action with
// the returned `syncRecordId` until `done: true`.
//
// Two phases, tracked in `sync_records.metadata.phase`:
//   "searching" — accumulating post-filtered Prospector matches across
//     however many invocations it takes to reach the rule's desiredVolume
//     (or CommonRoom genuinely running out of matches). The accumulated raw
//     matches themselves are round-tripped through metadata (JSON) between
//     invocations, since nothing else durable holds them — this table only
//     tracks post-resolution contactIds (see below).
//   "scoring" — once search + the existing dedup/insert loop have both
//     completed (exactly once, over ALL accumulated matches), each resulting
//     contactId gets one `sourcing_rule_run_targets` row. Each invocation
//     claims a small chunk of `pending` rows, scores/links them with the
//     existing bounded-concurrency logic, and flips them to `scored`/
//     `errored` — that queue table (not an in-memory counter) is the
//     durable source of truth for "how much scoring is left", since nothing
//     in-memory survives between invocations.
const MAX_SEARCH_PAGES_PER_INVOCATION = 4;
const SCORING_CHUNK_SIZE = 16;
const CONCURRENCY_LIMIT = 4;

// Same threshold and reasoning as the run-history UI's own `deriveRunStatus`
// (lists.tsx) — a "running" sync_records row whose startedAt is older than
// this is treated as abandoned (the hosting platform's own infrastructure
// killed the process mid-flight) rather than genuinely still in progress.
// Reusing the exact number keeps the concept consistent between what the
// UI displays and what the server does with a "running" row it finds.
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
  scoringErrors: string[];
  companiesConsidered: number | null;
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

export default defineAction({
  description:
    "Run (or resume) a sourcing rule's Prospector pipeline: qualify companies against its ICP (if any), derive persona-based Prospector search filters, search CommonRoom Prospector, upsert + score + segment-link every match, and log the sync run. Resumable and chunked — a single invocation does ONE bounded unit of work (a few more search pages, or a chunk of scoring) and returns {done: false, syncRecordId, ...} if more remains; the caller passes that syncRecordId back in to continue the SAME run instead of starting a new one. Pass no syncRecordId to start a fresh run (or attach to an already-in-progress one for this rule).",
  schema: z.object({ ruleId: z.string().min(1), syncRecordId: z.string().nullish() }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ ruleId, syncRecordId: requestedSyncRecordId }, ctx) => {
    const role = await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    const ruleRows = await db.select().from(sourcingRules).where(eq(sourcingRules.id, ruleId)).limit(1);
    const rule = ruleRows[0];
    if (!rule) {
      throw Object.assign(new Error(`Sourcing rule ${ruleId} not found.`), { statusCode: 404 });
    }

    // Ownership gate, matching update-sourcing-rule.ts/delete-sourcing-rule.ts
    // — re-checked on EVERY invocation (not just the first), since each
    // invocation is its own independent HTTP request/auth context.
    if (rule.ownerEmail !== ctx!.userEmail! && role !== "admin") {
      throw Object.assign(new Error("Only the sourcing rule's owner or a manager can run this rule's pipeline."), {
        statusCode: 403,
      });
    }

    // ── Resolve which sync_records row this invocation continues ───────────
    //
    // Three cases:
    //  1. Caller passed a syncRecordId — resume it directly (after confirming
    //     it's really this rule's and still "running").
    //  2. No syncRecordId, but a genuinely-still-running (non-stale) row for
    //     this rule already exists — ATTACH to it instead of starting a
    //     second concurrent run for the same rule (e.g. a manual click
    //     racing the scheduled job, or a double-click).
    //  3. Neither — start fresh.
    let syncRecordId: string;
    let runMetadata: Record<string, unknown>;
    let isFreshStart = false;

    if (requestedSyncRecordId) {
      const rows = await db
        .select({ id: syncRecords.id, sourcingRuleId: syncRecords.sourcingRuleId, status: syncRecords.status, metadata: syncRecords.metadata })
        .from(syncRecords)
        .where(eq(syncRecords.id, requestedSyncRecordId))
        .limit(1);
      const row = rows[0];
      if (!row || row.sourcingRuleId !== ruleId || row.status !== "running") {
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
        .where(and(eq(syncRecords.sourcingRuleId, ruleId), eq(syncRecords.status, "running")))
        .orderBy(desc(syncRecords.startedAt))
        .limit(1);
      const runningRow = runningRows[0];
      // Mirrors deriveRunStatus's exact staleness formula (lists.tsx) so a
      // row the UI would show as "running" is also attached to here, and one
      // it would show as "timedOut" is also treated as abandoned here.
      const startedMs = runningRow?.startedAt ? new Date(runningRow.startedAt).getTime() : NaN;
      const isStale = !Number.isNaN(startedMs) && Date.now() - startedMs > RUN_STALE_AFTER_MS;

      if (runningRow && !isStale) {
        syncRecordId = runningRow.id;
        runMetadata = parseMetadata(runningRow.metadata);
      } else {
        isFreshStart = true;

        // Defense-in-depth existence checks mirroring create-sourcing-rule.ts's
        // own validation — a correctly-created rule should never fail these,
        // but a persona/sub-persona/ICP deleted out from under a live rule
        // shouldn't surface as an opaque downstream error several steps
        // later.
        const personaRow = await db.select({ id: personas.id }).from(personas).where(eq(personas.id, rule.personaId)).limit(1);
        if (!personaRow[0]) {
          throw Object.assign(new Error(`Persona ${rule.personaId} not found.`), { statusCode: 404 });
        }
        if (rule.subPersonaId) {
          const subRow = await db
            .select({ id: subPersonas.id })
            .from(subPersonas)
            .where(and(eq(subPersonas.id, rule.subPersonaId), eq(subPersonas.personaId, rule.personaId)))
            .limit(1);
          if (!subRow[0]) {
            throw Object.assign(new Error(`Sub-persona ${rule.subPersonaId} not found under persona ${rule.personaId}.`), {
              statusCode: 404,
            });
          }
        }
        if (rule.icpId) {
          const icpRow = await db.select({ id: icps.id }).from(icps).where(eq(icps.id, rule.icpId)).limit(1);
          if (!icpRow[0]) {
            throw Object.assign(new Error(`ICP ${rule.icpId} not found.`), { statusCode: 404 });
          }
        }

        // Defense-in-depth: the rule owner must still legitimately own (or
        // manage) the segment this rule writes into.
        await assertSegmentWritable(rule.segmentId, rule.ownerEmail, db);

        syncRecordId = nanoid();
        const runStartedAt = new Date().toISOString();
        await db.insert(syncRecords).values({
          id: syncRecordId,
          source: "prospector",
          sourcingRuleId: ruleId,
          startedAt: runStartedAt,
          completedAt: null,
          recordsPulled: null,
          status: "running",
          metadata: JSON.stringify({
            sourcingRuleId: ruleId,
            phase: "searching",
            searchCursor: null,
            targetVolume: rule.desiredVolume,
            recordsFound: 0,
          }),
        });
        runMetadata = { phase: "searching" };
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
      // Best-effort cleanup of this run's ephemeral work queue — a failed
      // run is just as terminal as a successful one; this table only ever
      // holds in-progress-run state. Failure here must never mask the real
      // error being re-thrown below.
      try {
        await db.delete(sourcingRuleRunTargets).where(eq(sourcingRuleRunTargets.syncRecordId, syncRecordId));
      } catch {
        // best-effort, ignore
      }
      // Re-throw the ORIGINAL error unchanged — this is purely a side-effect
      // DB write on the way through; the real HTTP caller must still see
      // the actual failure exactly as it does today.
      throw err;
    }

    async function runPipelineBody(): Promise<PipelineResult> {
      if (isFreshStart) {
        return await startFreshAndSearch();
      }
      if (runMetadata.phase === "scoring") {
        return await runScoringChunk();
      }
      // phase === "searching" (a resumed run) — everything needed to
      // continue paging was cached on a prior invocation.
      return await resumeSearching();
    }

    // ── Fresh-start bootstrapping: existing ICP-qualification/short-circuit
    // and deriveProspectorFilters logic, run exactly ONCE per overall run.
    async function startFreshAndSearch(): Promise<PipelineResult> {
      const manualAllowList: string[] | null = rule.companyAllowList ? JSON.parse(rule.companyAllowList) : null;
      const manualDenyList: string[] | null = rule.companyDenyList ? JSON.parse(rule.companyDenyList) : null;

      // ICP company qualification. Only changes behavior when the rule
      // actually has an icpId — otherwise this is exactly today's
      // manual-allow/deny-list behavior, unchanged.
      let companiesConsidered: number | null = null;
      let effectiveAllowList: string[] | undefined = manualAllowList ?? undefined;
      const effectiveDenyList: string[] | undefined = manualDenyList ?? undefined;
      // Lowercased company name -> known employee count, from the ICP-
      // qualified companies list — feeds scoreContactAgainstPersonas's
      // deterministic company-fit signal (per-contact) when a match's
      // company was one of the companies the ICP search already qualified.
      // A plain JSON-serializable object (not a Map) since this needs to
      // round-trip through sync_records.metadata across invocations if
      // search takes more than one.
      const companyEmployeesByName: Record<string, number> = {};

      if (rule.icpId) {
        const icpLimit = Math.min(200, rule.desiredVolume * 3);
        const { records: icpCompanies } = await searchIcpCompanies({
          icpId: rule.icpId,
          userEmail: rule.ownerEmail,
          orgId: ctx?.orgId,
          limit: icpLimit,
        });
        companiesConsidered = icpCompanies.length;
        const icpNames = icpCompanies.map((c) => c.name).filter((n): n is string => !!n);
        for (const c of icpCompanies) {
          if (c.name && c.employees != null) {
            companyEmployeesByName[c.name.toLowerCase()] = c.employees;
          }
        }

        if (manualAllowList && manualAllowList.length > 0) {
          // A company must appear in BOTH the ICP-qualified list and the
          // manual allow list to qualify — the manual list narrows the ICP
          // list rather than being silently discarded.
          const manualLower = new Set(manualAllowList.map((n) => n.toLowerCase()));
          effectiveAllowList = icpNames.filter((n) => manualLower.has(n.toLowerCase()));
        } else {
          effectiveAllowList = icpNames;
        }
      }

      // If the rule has an ICP and NO company ended up qualifying,
      // searchProspectorContacts's own allow-list semantics treat an EMPTY
      // array the same as "no allow list at all" — passing an empty array
      // through would silently admit every company instead of correctly
      // admitting none. Short-circuit instead: a rule with 0 ICP-qualified
      // companies should find 0 contacts, not fall back to unfiltered
      // results.
      if (rule.icpId && effectiveAllowList && effectiveAllowList.length === 0) {
        const completedAt = new Date().toISOString();
        await db
          .update(syncRecords)
          .set({
            completedAt,
            status: "success",
            recordsPulled: 0,
            metadata: JSON.stringify({ sourcingRuleId: ruleId, companiesConsidered, icpQualifiedZeroCompanies: true }),
          })
          .where(eq(syncRecords.id, syncRecordId));
        await logAnalyticsEvent(rule.ownerEmail, "sync_run", {
          source: "prospector",
          status: "success",
          recordsPulled: 0,
          sourcingRuleId: ruleId,
          companiesConsidered,
          icpQualifiedZeroCompanies: true,
        });
        return {
          done: true,
          syncRecordId,
          phase: "complete",
          recordsFound: 0,
          scored: 0,
          remaining: 0,
          imported: 0,
          deduped: 0,
          scoringErrors: [],
          companiesConsidered,
        };
      }

      // Up to 2 linked Sales Library docs as extra grounding context for the
      // persona-filter derivation prompt.
      const linkConditions = [eq(libraryDocs.linkedPersonaId, rule.personaId)];
      if (rule.icpId) linkConditions.push(eq(libraryDocs.linkedIcpId, rule.icpId));
      const linkedDocs = await db
        .select({ id: libraryDocs.id, name: libraryDocs.name, category: libraryDocs.category, content: libraryDocs.content })
        .from(libraryDocs)
        .where(or(...linkConditions))
        .orderBy(desc(libraryDocs.createdAt));

      const groundingDocs = [...linkedDocs]
        .sort((a, b) => {
          const aPref = PREFERRED_GROUNDING_CATEGORIES.has(a.category) ? 0 : 1;
          const bPref = PREFERRED_GROUNDING_CATEGORIES.has(b.category) ? 0 : 1;
          return aPref - bPref;
        })
        .slice(0, MAX_GROUNDING_DOCS);

      const extraContext =
        groundingDocs.length > 0
          ? groundingDocs
              .map((d) => `[${d.category}] ${d.name}\n${d.content.slice(0, GROUNDING_DOC_EXCERPT_LENGTH)}`)
              .join("\n\n---\n\n")
          : undefined;

      // deriveProspectorFilters runs exactly ONCE per overall run, here at
      // the very start of the search phase — its result (titleKeyword/
      // seniority) is cached into sync_records.metadata below so a resumed
      // search-continuation invocation reuses it instead of making another
      // LLM call.
      const filters = await deriveProspectorFilters({
        personaId: rule.personaId,
        subPersonaId: rule.subPersonaId,
        userEmail: rule.ownerEmail,
        orgId: ctx?.orgId,
        extraContext,
      });

      return await runSearchRound({
        cursor: undefined,
        targetVolume: rule.desiredVolume,
        recordsFoundSoFar: 0,
        accumulatedMatches: [],
        titleKeyword: filters.titleKeyword,
        seniority: filters.seniority,
        effectiveAllowList,
        effectiveDenyList,
        companiesConsidered,
        companyEmployeesByName,
      });
    }

    // ── Resume a run whose last invocation stopped mid-search (hit the
    // per-invocation page cap without reaching the target or exhausting
    // CommonRoom) — everything needed to continue paging was cached in
    // metadata by that prior invocation.
    async function resumeSearching(): Promise<PipelineResult> {
      const meta = runMetadata;
      const cursor = (meta.searchCursor as string | null | undefined) ?? undefined;
      const targetVolume = (meta.targetVolume as number | undefined) ?? rule.desiredVolume;
      const recordsFoundSoFar = (meta.recordsFound as number | undefined) ?? 0;
      const accumulatedMatches = (meta.accumulatedMatches as ProspectorMatch[] | undefined) ?? [];
      const titleKeyword = (meta.titleKeyword as string | null | undefined) ?? null;
      const seniority = (meta.seniority as string | null | undefined) ?? null;
      const effectiveAllowList = (meta.effectiveAllowList as string[] | null | undefined) ?? undefined;
      const effectiveDenyList = (meta.effectiveDenyList as string[] | null | undefined) ?? undefined;
      const companiesConsidered = (meta.companiesConsidered as number | null | undefined) ?? null;
      const companyEmployeesByName = (meta.companyEmployeesByName as Record<string, number> | undefined) ?? {};

      return await runSearchRound({
        cursor,
        targetVolume,
        recordsFoundSoFar,
        accumulatedMatches,
        titleKeyword,
        seniority,
        effectiveAllowList: effectiveAllowList ?? undefined,
        effectiveDenyList: effectiveDenyList ?? undefined,
        companiesConsidered,
        companyEmployeesByName,
      });
    }

    // ── One bounded round of search-page-fetching (phase "searching") ──────
    //
    // Fetches up to MAX_SEARCH_PAGES_PER_INVOCATION pages, following
    // `nextCursor` between them within THIS SAME invocation, accumulating
    // post-filtered matches until either the target volume is reached,
    // CommonRoom reports genuinely no more matches, or the page cap is hit
    // (in which case this invocation checkpoints and returns `done: false`
    // so the caller invokes again to continue).
    async function runSearchRound(params: {
      cursor: string | undefined;
      targetVolume: number;
      recordsFoundSoFar: number;
      accumulatedMatches: ProspectorMatch[];
      titleKeyword: string | null;
      seniority: string | null;
      effectiveAllowList: string[] | undefined;
      effectiveDenyList: string[] | undefined;
      companiesConsidered: number | null;
      companyEmployeesByName: Record<string, number>;
    }): Promise<PipelineResult> {
      let cursor = params.cursor;
      const newMatches: ProspectorMatch[] = [];
      let newCount = 0;
      let searchDone = false;

      for (let page = 0; page < MAX_SEARCH_PAGES_PER_INVOCATION; page++) {
        const remainingNeeded = params.targetVolume - (params.recordsFoundSoFar + newCount);
        if (remainingNeeded <= 0) {
          searchDone = true;
          break;
        }

        const pageResult = await searchProspectorContacts({
          orgId: ctx?.orgId,
          titleKeyword: params.titleKeyword ?? undefined,
          seniority: params.seniority ?? undefined,
          companyAllowList: params.effectiveAllowList,
          companyDenyList: params.effectiveDenyList,
          limit: remainingNeeded,
          cursor,
        });

        newMatches.push(...pageResult.records);
        newCount += pageResult.records.length;
        cursor = pageResult.nextCursor;

        // Genuinely exhausted (CommonRoom says no more, or gave no cursor to
        // continue with even though it claimed more exist — defensive
        // fallback to avoid ever looping forever on a contract violation).
        if (!pageResult.hasMore || !cursor) {
          searchDone = true;
          break;
        }
        if (params.recordsFoundSoFar + newCount >= params.targetVolume) {
          searchDone = true;
          break;
        }
      }

      const totalRecordsFound = params.recordsFoundSoFar + newCount;
      const allMatches = [...params.accumulatedMatches, ...newMatches];

      if (!searchDone) {
        // Stopped only because this invocation hit its own page cap, not
        // because the search is actually finished — checkpoint progress and
        // ask the caller to invoke again to keep paging.
        await db
          .update(syncRecords)
          .set({
            metadata: JSON.stringify({
              sourcingRuleId: ruleId,
              phase: "searching",
              searchCursor: cursor ?? null,
              targetVolume: params.targetVolume,
              recordsFound: totalRecordsFound,
              accumulatedMatches: allMatches,
              titleKeyword: params.titleKeyword,
              seniority: params.seniority,
              effectiveAllowList: params.effectiveAllowList ?? null,
              effectiveDenyList: params.effectiveDenyList ?? null,
              companiesConsidered: params.companiesConsidered,
              companyEmployeesByName: params.companyEmployeesByName,
            }),
          })
          .where(eq(syncRecords.id, syncRecordId));

        return {
          done: false,
          syncRecordId,
          phase: "searching",
          recordsFound: totalRecordsFound,
          scored: 0,
          remaining: 0,
          imported: 0,
          deduped: 0,
          scoringErrors: [],
          companiesConsidered: params.companiesConsidered,
        };
      }

      // Search is genuinely complete (target reached, or CommonRoom
      // exhausted). If nothing was ever found at all, this run is actually
      // complete right now — no contacts to resolve or score.
      if (allMatches.length === 0) {
        return await finishRun({
          recordsFound: 0,
          imported: 0,
          deduped: 0,
          companiesConsidered: params.companiesConsidered,
        });
      }

      // Phase 1 — the EXISTING sequential dedup/insert-or-update decision,
      // reused byte-for-byte, now running exactly once over ALL matches
      // accumulated across however many invocations it took to gather them.
      // Must stay strictly sequential in original match order — see
      // resolveContact's own comment for why.
      const now = new Date().toISOString();
      let imported = 0;
      let deduped = 0;
      const resolvedContactIds: string[] = [];
      for (const match of allMatches) {
        const { contactId, isCrossSourceDedup } = await resolveContact(match, params.companyEmployeesByName, now);
        if (isCrossSourceDedup) {
          deduped++;
        } else {
          imported++;
        }
        resolvedContactIds.push(contactId);
      }

      // De-duplicate by contactId before handing off to scoring — two
      // DIFFERENT Prospector matches can legitimately resolve (via
      // cross-source dedup) to the SAME existing contact row; each real
      // contact should only get one scoring work-queue row.
      const seenContactIds = new Set<string>();
      const uniqueContactIds = resolvedContactIds.filter((id) => {
        if (seenContactIds.has(id)) return false;
        seenContactIds.add(id);
        return true;
      });

      for (const contactId of uniqueContactIds) {
        await db.insert(sourcingRuleRunTargets).values({ id: nanoid(), syncRecordId, contactId, status: "pending" });
      }

      await db
        .update(syncRecords)
        .set({
          metadata: JSON.stringify({
            sourcingRuleId: ruleId,
            phase: "scoring",
            recordsFound: totalRecordsFound,
            imported,
            deduped,
            companiesConsidered: params.companiesConsidered,
            scored: 0,
            scoringErrorCount: 0,
          }),
        })
        .where(eq(syncRecords.id, syncRecordId));

      return {
        done: false,
        syncRecordId,
        phase: "scoring",
        recordsFound: totalRecordsFound,
        scored: 0,
        remaining: uniqueContactIds.length,
        imported,
        deduped,
        scoringErrors: [],
        companiesConsidered: params.companiesConsidered,
      };
    }

    // Phase 1's existing-check/dedup/insert-or-update decision — identical
    // logic and order of operations to the pre-existing sequential loop.
    // ADAPTED to also persist country/employees onto the contact row (a
    // previously-unused pair of columns for prospector-sourced contacts):
    // once scoring runs in a SEPARATE invocation from this resolution step,
    // there is no longer a live `match` object available to read
    // location.country/companyEmployeesByName from at scoring time — so
    // those firmographic signals must be persisted here to survive to
    // whichever later invocation actually scores this contact.
    async function resolveContact(
      match: ProspectorMatch,
      companyEmployeesByName: Record<string, number>,
      now: string,
    ): Promise<{ contactId: string; isCrossSourceDedup: boolean }> {
      const linkedinUrl = match.linkedInHandle ? `https://www.linkedin.com/${match.linkedInHandle}` : null;
      const country = match.location?.country ?? null;
      const employees = companyEmployeesByName[match.companyName?.toLowerCase() ?? ""] ?? null;

      const existing = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.externalId, match.id), eq(contacts.source, "prospector")))
        .limit(1);

      let contactId: string;
      let isCrossSourceDedup = false;
      if (existing[0]) {
        contactId = existing[0].id;
        // Mirrors import-prospects-to-segment.ts's update path: refresh the
        // source-of-truth fields but never touch `status` here — that's
        // per-contact worked state the XDR owns, not something a re-import
        // should reset.
        await db
          .update(contacts)
          .set({
            name: match.fullName ?? "Unknown",
            title: match.title ?? null,
            company: match.companyName ?? null,
            email: null,
            linkedinUrl,
            country,
            employees,
            syncedAt: now,
            updatedAt: now,
          })
          .where(eq(contacts.id, contactId));
      } else {
        // No same-source (externalId, source="prospector") row exists yet —
        // but this match might still be a contact we already have from a
        // DIFFERENT source. Check by email and by normalized LinkedIn
        // vanity-slug before deciding this is truly a new person.
        const matchEmail = (match as { email?: string | null }).email ?? null;
        const linkedinSlug = normalizeLinkedinUrl(linkedinUrl);

        const dedupConditions = [];
        if (matchEmail) {
          dedupConditions.push(sql`LOWER(${contacts.email}) = LOWER(${matchEmail})`);
        }
        if (linkedinSlug) {
          // Coarse SQL-level candidate filter only — see the LIKE-vs-exact
          // comment this mirrors from the original implementation.
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
          // touch its name/title/company/country/employees/etc.
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
            country,
            employees,
            source: "prospector",
            externalId: match.id,
            status: "active",
            syncedAt: now,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      return { contactId, isCrossSourceDedup };
    }

    // ── One bounded chunk of scoring (phase "scoring") ──────────────────────
    //
    // Claims up to SCORING_CHUNK_SIZE `pending` rows from the work queue,
    // scores/links them with the existing bounded-concurrency logic, and
    // flips each to `scored`/`errored`. The queue table's own aggregate
    // counts (not an in-memory counter) are the source of truth for
    // scored/errored/remaining, since nothing in-memory survives between
    // invocations.
    async function runScoringChunk(): Promise<PipelineResult> {
      const pendingRows = await db
        .select({ id: sourcingRuleRunTargets.id, contactId: sourcingRuleRunTargets.contactId })
        .from(sourcingRuleRunTargets)
        .where(and(eq(sourcingRuleRunTargets.syncRecordId, syncRecordId), eq(sourcingRuleRunTargets.status, "pending")))
        .orderBy(sourcingRuleRunTargets.createdAt)
        .limit(SCORING_CHUNK_SIZE);

      const currentMetaRows = await db
        .select({ metadata: syncRecords.metadata })
        .from(syncRecords)
        .where(eq(syncRecords.id, syncRecordId))
        .limit(1);
      const currentMeta = parseMetadata(currentMetaRows[0]?.metadata ?? null);
      const recordsFound = (currentMeta.recordsFound as number | undefined) ?? 0;
      const imported = (currentMeta.imported as number | undefined) ?? 0;
      const deduped = (currentMeta.deduped as number | undefined) ?? 0;
      const companiesConsidered = (currentMeta.companiesConsidered as number | null | undefined) ?? null;

      if (pendingRows.length === 0) {
        return await finishRun({ recordsFound, imported, deduped, companiesConsidered });
      }

      // Same pool of scorable personas import-prospects-to-segment.ts
      // queries — re-fetched fresh each invocation (cheap) rather than
      // cached, since nothing in-memory survives between invocations
      // anyway.
      const personaRowsForScoring = await db
        .select({ id: personas.id, name: personas.name, criteria: personas.criteria })
        .from(personas)
        .where(sql`${personas.criteria} IS NOT NULL`);

      // Scoring and everything that depends on it is wrapped so a single
      // contact's bad AI response or a CommonRoom lookup failure can't abort
      // any other contact in this chunk — mirrors the original
      // scoreAndLinkContact exactly, just sourcing its contact fields from
      // the `contacts` table (country/employees persisted there by
      // resolveContact above) instead of a live Prospector match object,
      // and writing its outcome to the work-queue row instead of an
      // in-memory counter.
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
            },
            personas: personaRowsForScoring,
            userEmail: rule.ownerEmail,
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
            .where(eq(contacts.id, target.contactId));

          const existingLink = await db
            .select({ id: segmentContacts.id })
            .from(segmentContacts)
            .where(and(eq(segmentContacts.segmentId, rule.segmentId), eq(segmentContacts.contactId, target.contactId)))
            .limit(1);
          if (!existingLink[0]) {
            await db.insert(segmentContacts).values({ id: nanoid(), segmentId: rule.segmentId, contactId: target.contactId });
          }

          await db
            .update(sourcingRuleRunTargets)
            .set({ status: "scored", error: null })
            .where(eq(sourcingRuleRunTargets.id, target.id));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // Still link the contact into the segment even when scoring
          // failed — best-effort, a failure here doesn't matter for the
          // pipeline's overall outcome.
          try {
            const existingLink = await db
              .select({ id: segmentContacts.id })
              .from(segmentContacts)
              .where(and(eq(segmentContacts.segmentId, rule.segmentId), eq(segmentContacts.contactId, target.contactId)))
              .limit(1);
            if (!existingLink[0]) {
              await db.insert(segmentContacts).values({ id: nanoid(), segmentId: rule.segmentId, contactId: target.contactId });
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

      // Bounded-concurrency batches, same CONCURRENCY_LIMIT/Promise.allSettled
      // reasoning as the original perf fix.
      for (let i = 0; i < pendingRows.length; i += CONCURRENCY_LIMIT) {
        const batch = pendingRows.slice(i, i + CONCURRENCY_LIMIT);
        await Promise.allSettled(batch.map((target) => scoreAndLinkTarget(target)));
      }

      const [scoredCountRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(sourcingRuleRunTargets)
        .where(and(eq(sourcingRuleRunTargets.syncRecordId, syncRecordId), eq(sourcingRuleRunTargets.status, "scored")));
      const [erroredCountRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(sourcingRuleRunTargets)
        .where(and(eq(sourcingRuleRunTargets.syncRecordId, syncRecordId), eq(sourcingRuleRunTargets.status, "errored")));
      const [pendingCountRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(sourcingRuleRunTargets)
        .where(and(eq(sourcingRuleRunTargets.syncRecordId, syncRecordId), eq(sourcingRuleRunTargets.status, "pending")));

      const scored = Number(scoredCountRow?.count ?? 0);
      const scoringErrorCount = Number(erroredCountRow?.count ?? 0);
      const remaining = Number(pendingCountRow?.count ?? 0);

      if (remaining === 0) {
        return await finishRun({ recordsFound, imported, deduped, companiesConsidered });
      }

      // Checkpoint after every chunk — same pattern as the original
      // per-batch checkpoint, just sourcing the running totals from the
      // queue table's aggregate state instead of in-memory counters that
      // don't persist across invocations.
      await db
        .update(syncRecords)
        .set({
          metadata: JSON.stringify({
            sourcingRuleId: ruleId,
            phase: "scoring",
            recordsFound,
            imported,
            deduped,
            companiesConsidered,
            scored,
            scoringErrorCount,
          }),
        })
        .where(eq(syncRecords.id, syncRecordId));

      const errorRows = await db
        .select({ error: sourcingRuleRunTargets.error })
        .from(sourcingRuleRunTargets)
        .where(and(eq(sourcingRuleRunTargets.syncRecordId, syncRecordId), eq(sourcingRuleRunTargets.status, "errored")));
      const scoringErrors = errorRows.map((r) => r.error).filter((e): e is string => !!e);

      return {
        done: false,
        syncRecordId,
        phase: "scoring",
        recordsFound,
        scored,
        remaining,
        imported,
        deduped,
        scoringErrors,
        companiesConsidered,
      };
    }

    // ── Final success write — same shape as the original one-invocation
    // pipeline's final write, just reached via this multi-invocation path.
    // Also cleans up this run's ephemeral work-queue rows: they only ever
    // represent in-progress-run state, never a permanent record.
    async function finishRun(counts: {
      recordsFound: number;
      imported: number;
      deduped: number;
      companiesConsidered: number | null;
    }): Promise<PipelineResult> {
      const [scoredCountRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(sourcingRuleRunTargets)
        .where(and(eq(sourcingRuleRunTargets.syncRecordId, syncRecordId), eq(sourcingRuleRunTargets.status, "scored")));
      const [erroredCountRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(sourcingRuleRunTargets)
        .where(and(eq(sourcingRuleRunTargets.syncRecordId, syncRecordId), eq(sourcingRuleRunTargets.status, "errored")));
      const errorRows = await db
        .select({ error: sourcingRuleRunTargets.error })
        .from(sourcingRuleRunTargets)
        .where(and(eq(sourcingRuleRunTargets.syncRecordId, syncRecordId), eq(sourcingRuleRunTargets.status, "errored")));

      const scored = Number(scoredCountRow?.count ?? 0);
      const scoringErrorCount = Number(erroredCountRow?.count ?? 0);
      const scoringErrors = errorRows.map((r) => r.error).filter((e): e is string => !!e);

      const completedAt = new Date().toISOString();
      await db
        .update(syncRecords)
        .set({
          completedAt,
          status: "success",
          recordsPulled: counts.recordsFound,
          metadata: JSON.stringify({
            sourcingRuleId: ruleId,
            companiesConsidered: counts.companiesConsidered,
            icpQualifiedZeroCompanies: false,
            scoringErrorCount,
            deduped: counts.deduped,
            phase: "complete",
            recordsFound: counts.recordsFound,
            imported: counts.imported,
            scored,
          }),
        })
        .where(eq(syncRecords.id, syncRecordId));

      await db.delete(sourcingRuleRunTargets).where(eq(sourcingRuleRunTargets.syncRecordId, syncRecordId));

      await logAnalyticsEvent(rule.ownerEmail, "sync_run", {
        source: "prospector",
        status: "success",
        recordsPulled: counts.recordsFound,
        sourcingRuleId: ruleId,
        companiesConsidered: counts.companiesConsidered,
        icpQualifiedZeroCompanies: false,
        scoringErrorCount,
        deduped: counts.deduped,
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
        scoringErrors,
        companiesConsidered: counts.companiesConsidered,
      };
    }
  },
});
