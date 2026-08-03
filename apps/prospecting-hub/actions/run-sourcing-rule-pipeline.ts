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
  sourcingRules,
  subPersonas,
  syncRecords,
} from "../server/db/schema.js";
import { logAnalyticsEvent } from "../server/helpers/analytics.js";
import { deriveProspectorFilters } from "../server/helpers/derive-prospector-filters.js";
import { searchIcpCompanies } from "../server/helpers/icp-filters.js";
import { escapeLikePattern, normalizeLinkedinUrl } from "../server/helpers/normalize-linkedin-url.js";
import { searchProspectorContacts } from "../server/helpers/prospector-client.js";
import { requireRole } from "../server/helpers/require-role.js";
import { scoreContactAgainstPersonas } from "../server/helpers/score-contact.js";
import { assertSegmentWritable } from "../server/helpers/segment-access.js";

// Library-doc categories preferred as grounding context for the persona-
// filter derivation prompt — a simple "prefer these categories" heuristic
// per the task brief, not a relevance-ranking model.
const PREFERRED_GROUNDING_CATEGORIES = new Set(["icp", "persona_messaging"]);
const MAX_GROUNDING_DOCS = 2;
const GROUNDING_DOC_EXCERPT_LENGTH = 3000;

export default defineAction({
  description:
    "Run a sourcing rule's full scheduled pipeline end to end: qualify companies against its ICP (if any), derive persona-based Prospector search filters (grounded with any linked Sales Library docs), search CommonRoom Prospector, upsert + score + segment-link every match, and log the sync run. This is the single deterministic action the rule's recurring job calls directly — it replaces the old agent-orchestrated 3-tool-call sequence (derive-prospector-filters, search-commonroom-prospects, import-prospects-to-segment).",
  schema: z.object({ ruleId: z.string().min(1) }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ ruleId }, ctx) => {
    const role = await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    const ruleRows = await db.select().from(sourcingRules).where(eq(sourcingRules.id, ruleId)).limit(1);
    const rule = ruleRows[0];
    if (!rule) {
      throw Object.assign(new Error(`Sourcing rule ${ruleId} not found.`), { statusCode: 404 });
    }

    // Ownership gate, matching update-sourcing-rule.ts/delete-sourcing-rule.ts:
    // any XDR/AE passes the role gate above, but only the rule's own owner
    // (or an admin) may actually run it — otherwise any XDR/AE could
    // manually trigger any OTHER user's rule by ruleId (no data leak, since
    // writes still target the rule owner's own segment via
    // assertSegmentWritable below, but an authorization-consistency gap and
    // a mild quota-abuse vector). The scheduled path runs `runAs: creator`
    // (i.e. as the rule's own owner), so this never affects the scheduled
    // flow — only manual/chat-triggered calls.
    if (rule.ownerEmail !== ctx!.userEmail! && role !== "admin") {
      throw Object.assign(new Error("Only the sourcing rule's owner or a manager can run this rule's pipeline."), {
        statusCode: 403,
      });
    }

    // Defense-in-depth existence checks mirroring create-sourcing-rule.ts's
    // own validation — a correctly-created rule should never fail these, but
    // a persona/sub-persona/ICP deleted out from under a live rule shouldn't
    // surface as an opaque downstream error from deriveProspectorFilters or
    // searchIcpCompanies several steps later.
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
    // manage) the segment this rule writes into — same
    // Task-7-fix-wave pattern already established in
    // import-prospects-to-segment.ts.
    await assertSegmentWritable(rule.segmentId, rule.ownerEmail, db);

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
    // deterministic company-fit signal below (per-contact) when a match's
    // company was one of the companies the ICP search already qualified.
    // Stays empty for a rule with no icpId (the AI-judged companyFitScore
    // remains the fallback in that case, unchanged).
    const companyEmployeesByName = new Map<string, number>();

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
          companyEmployeesByName.set(c.name.toLowerCase(), c.employees);
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

    // If the rule has an ICP and NO company ended up qualifying (either the
    // ICP search itself returned nothing, or the manual allow list and the
    // ICP list don't overlap at all), searchProspectorContacts's own
    // allow-list semantics treat an EMPTY array the same as "no allow list at
    // all" (see prospector-client.ts: `if (allowList && allowList.length > 0)`)
    // — passing an empty array through would silently admit every company
    // instead of correctly admitting none. Short-circuit instead: a rule
    // with 0 ICP-qualified companies should find 0 contacts, not fall back
    // to unfiltered results.
    if (rule.icpId && effectiveAllowList && effectiveAllowList.length === 0) {
      const completedAt = new Date().toISOString();
      await db.insert(syncRecords).values({
        id: nanoid(),
        source: "prospector",
        startedAt: completedAt,
        completedAt,
        status: "success",
        recordsPulled: 0,
        // Distinguishes "the ICP qualified zero companies, so this rule is
        // effectively dead" from "a quiet day, nothing new today" — both
        // are status: "success" / recordsPulled: 0 otherwise indistinguishable.
        metadata: JSON.stringify({ sourcingRuleId: ruleId, companiesConsidered, icpQualifiedZeroCompanies: true }),
      });
      await logAnalyticsEvent(rule.ownerEmail, "sync_run", {
        source: "prospector",
        status: "success",
        recordsPulled: 0,
        sourcingRuleId: ruleId,
        companiesConsidered,
        icpQualifiedZeroCompanies: true,
      });
      return { imported: 0, scored: 0, deduped: 0, segmentId: rule.segmentId, companiesConsidered };
    }

    // Up to 2 linked Sales Library docs as extra grounding context for the
    // persona-filter derivation prompt — docs whose category is "icp" or
    // "persona_messaging" preferred, per the brief's simple heuristic (no
    // relevance-ranking model). Queried directly against libraryDocs (not
    // via list-library-docs.ts, to avoid a nested action-to-action hop).
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

    const filters = await deriveProspectorFilters({
      personaId: rule.personaId,
      subPersonaId: rule.subPersonaId,
      userEmail: rule.ownerEmail,
      orgId: ctx?.orgId,
      extraContext,
    });

    const { records } = await searchProspectorContacts({
      orgId: ctx?.orgId,
      titleKeyword: filters.titleKeyword ?? undefined,
      seniority: filters.seniority ?? undefined,
      companyAllowList: effectiveAllowList,
      companyDenyList: effectiveDenyList,
      limit: rule.desiredVolume,
    });

    // Same pool of scorable personas import-prospects-to-segment.ts queries
    // — scoreContactAgainstPersonas itself picks the single best-fitting one
    // per contact, across ALL personas with synced criteria, not just this
    // rule's own persona.
    const personaRowsForScoring = await db
      .select({ id: personas.id, name: personas.name, criteria: personas.criteria })
      .from(personas)
      .where(sql`${personas.criteria} IS NOT NULL`);

    const now = new Date().toISOString();
    let imported = 0;
    let deduped = 0;
    let scored = 0;
    const scoringErrors: string[] = [];

    // This loop is split into two phases instead of one interleaved
    // per-contact block, specifically to make the concurrency change safe:
    //
    // Phase 1 (resolveContact, below) — the existing-check/dedup/
    // insert-or-update decision — stays STRICTLY SEQUENTIAL, in original
    // `records` order, byte-for-byte the same logic and the same order of
    // operations as the pre-existing sequential loop. This matters because
    // this decision reads the `contacts` table to decide "does this
    // person already exist" and then writes to it — if two matches in the
    // same run resolve to the SAME identity (e.g. two Prospector records
    // that turn out to share an email/LinkedIn slug — verified live during
    // this fix's testing to be possible, not just theoretical, when forced
    // deliberately), running that decision concurrently lets both see
    // "no existing row" before either commits, and both insert a duplicate
    // contact row for one real person. Keeping this phase sequential
    // eliminates that race entirely: every match's dedup check always sees
    // every earlier match's already-committed result, exactly as the
    // original loop guaranteed.
    //
    // Phase 2 (scoreAndLinkContact, below) — the actually expensive part
    // (one completeText() LLM call + up to 2 CommonRoom lookups per
    // contact) — runs in bounded-concurrency batches (CONCURRENCY_LIMIT).
    // This is where root cause #2 (20 sequential rounds of network calls)
    // actually lived, and where the ~4x wall-clock win comes from. Each
    // unique contactId produced by phase 1 is scored/linked at most once
    // (see the `Set`-based de-duplication before phase 2 starts below) —
    // closing the residual case where two DIFFERENT Prospector matches
    // legitimately resolved (sequentially, safely) to the SAME existing
    // contactId via cross-source dedup, which would otherwise let two
    // concurrent scoring calls race on the same contact's segment-link
    // insert.
    async function resolveContact(match: (typeof records)[number]): Promise<{ contactId: string; isCrossSourceDedup: boolean }> {
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

      return { contactId, isCrossSourceDedup };
    }

    // Scoring and everything that depends on it is wrapped so a single
    // contact's bad AI response (e.g. truncated/unparseable JSON) or a
    // CommonRoom lookup failure can't abort any other contact — this
    // contact is already correctly imported via resolveContact above
    // regardless; a scoring failure just means it stays unscored for now,
    // re-scorable later via "Refresh scores". Safe to run concurrently
    // across contacts (see CONCURRENCY_LIMIT below): mutates the shared
    // `scored` counter and `scoringErrors` array, which is safe under
    // concurrent async execution — JS is single-threaded, so `scored++`
    // and `scoringErrors.push(...)` always run to completion as one
    // synchronous step before any other queued microtask can run; there is
    // no way for two concurrently in-flight calls to interleave
    // mid-increment or mid-push. Concurrency only changes the ORDER these
    // synchronous steps happen in relative to each contact's own network
    // calls (the LLM call, CommonRoom lookups), never their atomicity.
    async function scoreAndLinkContact(match: (typeof records)[number], contactId: string): Promise<void> {
      try {
        const score = await scoreContactAgainstPersonas({
          contact: {
            name: match.fullName ?? "Unknown",
            title: match.title ?? null,
            company: match.companyName ?? null,
            // Real firmographic signals, when available, feed
            // computeDeterministicCompanyFit() inside scoreContactAgainstPersonas
            // and take over companyFitScore in place of the AI-judged value:
            // - country: straight from this Prospector match's own location.
            // - employees: only known when this match's company was one of the
            //   rule's ICP-qualified companies (empty map for a no-ICP rule, or
            //   null when the company wasn't in the qualified set).
            country: match.location?.country ?? null,
            employees: companyEmployeesByName.get(match.companyName?.toLowerCase() ?? "") ?? null,
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
          .where(eq(contacts.id, contactId));
        scored++;

        const existingLink = await db
          .select({ id: segmentContacts.id })
          .from(segmentContacts)
          .where(and(eq(segmentContacts.segmentId, rule.segmentId), eq(segmentContacts.contactId, contactId)))
          .limit(1);
        if (!existingLink[0]) {
          await db.insert(segmentContacts).values({ id: nanoid(), segmentId: rule.segmentId, contactId });
        }
      } catch (err) {
        scoringErrors.push(`${contactId} (${match.fullName ?? "Unknown"}): ${err instanceof Error ? err.message : String(err)}`);
        // Still link the contact into the segment even when scoring failed —
        // it was legitimately found by this rule's search, it just doesn't
        // have a score yet. Best-effort; a failure here doesn't matter for
        // the pipeline's overall outcome.
        try {
          const existingLink = await db
            .select({ id: segmentContacts.id })
            .from(segmentContacts)
            .where(and(eq(segmentContacts.segmentId, rule.segmentId), eq(segmentContacts.contactId, contactId)))
            .limit(1);
          if (!existingLink[0]) {
            await db.insert(segmentContacts).values({ id: nanoid(), segmentId: rule.segmentId, contactId });
          }
        } catch {
          // best-effort, ignore
        }
      }
    }

    // Phase 1: resolve every match's contact row STRICTLY sequentially, in
    // original `records` order — identical order of operations to the
    // pre-existing loop, so the dedup/insert decision behaves exactly as it
    // does today (see the big comment above resolveContact for why this
    // phase specifically must not be made concurrent).
    const resolved: { match: (typeof records)[number]; contactId: string }[] = [];
    for (const match of records) {
      const { contactId, isCrossSourceDedup } = await resolveContact(match);
      if (isCrossSourceDedup) {
        deduped++;
      } else {
        imported++;
      }
      resolved.push({ match, contactId });
    }

    // De-duplicate by contactId before scoring: two DIFFERENT Prospector
    // matches can legitimately resolve (via the cross-source dedup check
    // above) to the SAME existing contact row. Scoring/segment-linking that
    // row twice would be wasted work today, and would become a genuine race
    // on the segment-link insert once phase 2 runs concurrently (two
    // concurrent "does a link already exist for this contactId" checks
    // could both say no and both insert). Keeping only the first match for
    // each unique contactId sidesteps that entirely — each real contact is
    // scored/linked at most once, exactly once, same as if this whole
    // pipeline only ever saw distinct people.
    const seenContactIds = new Set<string>();
    const toScore = resolved.filter(({ contactId }) => {
      if (seenContactIds.has(contactId)) return false;
      seenContactIds.add(contactId);
      return true;
    });

    // Phase 2: bounded-concurrency batches for the actually expensive part
    // — for 20 contacts (a common `desiredVolume`), strictly sequential
    // scoring meant 20 sequential rounds of network calls (one LLM
    // completeText() call + up to 2 CommonRoom lookups each), which could
    // exceed the hosting platform's function timeout even after eliminating
    // the redundant resolveLeadScoreIds calls above. A cap of 4 gives a
    // meaningful ~4x wall-clock improvement without firing all of
    // `toScore.length` calls at once unbounded — this codebase has no
    // established precedent of concurrent CommonRoom MCP calls, so a
    // conservative cap is used rather than assuming the MCP transport
    // tolerates unbounded concurrency cleanly.
    //
    // Promise.allSettled (not Promise.all) is used specifically because it
    // never short-circuits on one rejection — one contact's scoring failure
    // can never abort sibling contacts in its own batch, subsequent
    // batches, or the pipeline as a whole. scoreAndLinkContact already
    // catches its own errors internally (see above), so no rejection is
    // actually expected here in practice — allSettled is still the right
    // primitive, not Promise.all, so a future change to that function's
    // error handling can't silently turn one contact's failure into an
    // abort of the rest of the run.
    const CONCURRENCY_LIMIT = 4;
    for (let i = 0; i < toScore.length; i += CONCURRENCY_LIMIT) {
      const batch = toScore.slice(i, i + CONCURRENCY_LIMIT);
      await Promise.allSettled(batch.map(({ match, contactId }) => scoreAndLinkContact(match, contactId)));
    }

    const syncCompletedAt = new Date().toISOString();
    await db.insert(syncRecords).values({
      id: nanoid(),
      source: "prospector",
      startedAt: syncCompletedAt,
      completedAt: syncCompletedAt,
      status: "success",
      recordsPulled: records.length,
      metadata: JSON.stringify({
        sourcingRuleId: ruleId,
        companiesConsidered,
        icpQualifiedZeroCompanies: false,
        scoringErrorCount: scoringErrors.length,
        deduped,
      }),
    });
    await logAnalyticsEvent(rule.ownerEmail, "sync_run", {
      source: "prospector",
      status: "success",
      recordsPulled: records.length,
      sourcingRuleId: ruleId,
      companiesConsidered,
      icpQualifiedZeroCompanies: false,
      scoringErrorCount: scoringErrors.length,
      deduped,
    });

    return { imported, scored, deduped, segmentId: rule.segmentId, companiesConsidered, scoringErrors };
  },
});
