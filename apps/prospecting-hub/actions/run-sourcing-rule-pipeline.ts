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
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    const ruleRows = await db.select().from(sourcingRules).where(eq(sourcingRules.id, ruleId)).limit(1);
    const rule = ruleRows[0];
    if (!rule) {
      throw Object.assign(new Error(`Sourcing rule ${ruleId} not found.`), { statusCode: 404 });
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
      });
      await logAnalyticsEvent(rule.ownerEmail, "sync_run", {
        source: "prospector",
        status: "success",
        recordsPulled: 0,
        sourcingRuleId: ruleId,
      });
      return { imported: 0, scored: 0, segmentId: rule.segmentId, companiesConsidered };
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
    let scored = 0;

    for (const match of records) {
      const linkedinUrl = match.linkedInHandle ? `https://www.linkedin.com/${match.linkedInHandle}` : null;

      const existing = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.externalId, match.id), eq(contacts.source, "prospector")))
        .limit(1);

      let contactId: string;
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
      imported++;

      const score = await scoreContactAgainstPersonas({
        contact: { name: match.fullName ?? "Unknown", title: match.title ?? null, company: match.companyName ?? null },
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
    }

    const syncCompletedAt = new Date().toISOString();
    await db.insert(syncRecords).values({
      id: nanoid(),
      source: "prospector",
      startedAt: syncCompletedAt,
      completedAt: syncCompletedAt,
      status: "success",
      recordsPulled: records.length,
    });
    await logAnalyticsEvent(rule.ownerEmail, "sync_run", {
      source: "prospector",
      status: "success",
      recordsPulled: records.length,
      sourcingRuleId: ruleId,
    });

    return { imported, scored, segmentId: rule.segmentId, companiesConsidered };
  },
});
