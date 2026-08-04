import { callMcpToolWithTimeout, parseMcpToolResult, resolveServerId } from "./commonroom-client.js";

// CommonRoom LeadScore lookups, reusing the exact same org-scoped MCP
// connection as the rest of commonroom-client.ts / prospector-client.ts /
// icp-filters.ts. Mirrors the exact best-match/no-match fuzzy-identity-
// matching discipline apps/li-agent/actions/check-hubspot-contact.ts already
// establishes for this same class of problem.
//
// A real CommonRoom workspace can have SEVERAL LeadScore models configured
// at once, mixing contact-level and org-level ones (live-confirmed: 7
// distinct scores in this workspace — "Contact Score V2", "Contact Intent
// Score", "Company Fit Score (Common Room)" (plus a stale "v1" duplicate),
// "Organization Score V2", "Org Intent Score", "ABX Account Prioritization").
// This module resolves three specific named signals by matching each
// LeadScore's `name`, since the catalog exposes no entity-type field to pick
// them out any other way:
//   - "Contact Score V2"              -> commonRoomFitScore (contact-level)
//   - "Contact Intent Score"          -> commonRoomIntentScore (contact-level)
//   - "Company Fit Score (Common Room)" (excluding the "v1" duplicate)
//                                     -> commonRoomCompanyFitScore (org-level)
// Any signal whose LeadScore isn't configured on this room, or whose
// looked-up Contact/Organization record has no matching leadScores entry,
// resolves to `null` — a normal, expected outcome, never an error.

interface CommonRoomLeadScoreRecord {
  id?: string;
  scoreId?: string;
  name?: string;
}

interface CommonRoomLeadScoreListResult {
  records?: CommonRoomLeadScoreRecord[];
}

interface CommonRoomScoreEntry {
  // Confirmed live: a matched Contact's/Organization's leadScores[].scoreId
  // comes back as a bare NUMBER (e.g. 17351), unlike the "ls_"-prefixed
  // STRING id the LeadScore list itself returns (e.g. "ls_17351") — see the
  // normalization in resolveLeadScoreIds/extractPercentile below.
  scoreId?: number;
  percentile?: number;
}

interface CommonRoomEngagementContact {
  id?: string;
  fullName?: string;
  companyName?: string;
  leadScores?: CommonRoomScoreEntry[];
}

interface CommonRoomContactListResult {
  records?: CommonRoomEngagementContact[];
}

interface CommonRoomOrganization {
  id?: string;
  name?: string;
  leadScores?: CommonRoomScoreEntry[];
}

interface CommonRoomOrganizationListResult {
  records?: CommonRoomOrganization[];
}

interface ResolvedLeadScoreIds {
  contactFitId: string | null; // "Contact Score V2"
  contactIntentId: string | null; // "Contact Intent Score"
  companyFitId: string | null; // "Company Fit Score (Common Room)", non-v1
}

// LeadScore ids come back as "ls_"-prefixed strings (e.g. "ls_17351") from
// the LeadScore list, but a matched Contact's/Organization's
// leadScores[].scoreId comes back as a bare number (e.g. 17351, no prefix).
// Normalize both sides to a bare numeric string so the comparison can't
// silently never-match on a type/format mismatch.
function normalizeLeadScoreId(raw: string | number | undefined | null): string | null {
  if (raw == null) return null;
  return String(raw).replace(/^ls_/, "");
}

// resolveLeadScoreIds resolves org-wide LeadScore model IDs ("Contact Score
// V2", "Contact Intent Score", "Company Fit Score (Common Room)") that are
// identical for the entire org for as long as nobody reconfigures LeadScore
// models in CommonRoom itself — which doesn't happen mid pipeline-run. Every
// scoreContactAgainstPersonas call for every contact was re-resolving these
// from scratch via a fresh commonroom_list_objects MCP round-trip, so a
// 20-contact sourcing-rule run made up to 19 completely redundant CommonRoom
// calls before any of the actual per-contact Contact/Organization lookups
// even started — directly contributing to the pipeline exceeding the
// hosting platform's function timeout (live-confirmed "Inactivity Timeout").
//
// A short-TTL in-memory cache, keyed by orgId, eliminates that redundancy:
// the first resolution within the TTL window does the real MCP call, every
// other resolution for the same org within the window is a synchronous
// cache hit. 5 minutes is long enough that a single pipeline run (which
// should complete in well under 5 minutes even before the concurrency fix
// below) never re-fetches, but short enough that a genuine LeadScore
// reconfiguration in CommonRoom shows up for the next run/scoring call
// reasonably promptly rather than staying stale indefinitely.
//
// This is a module-level cache in a serverless/Netlify Functions
// environment: a cold function instance starts with an empty cache, so this
// does NOT guarantee cross-invocation caching in production the way it
// would in a long-lived process. It DOES guarantee zero redundant calls
// WITHIN a single invocation's lifetime — e.g. all contacts scored during
// one run-sourcing-rule-pipeline call share the same warm process and thus
// the same cache entry — which is the actual problem being fixed here. Warm
// function-instance reuse across nearby requests is a possible bonus, not a
// requirement this fix depends on.
const LEAD_SCORE_ID_CACHE_TTL_MS = 5 * 60 * 1000;
const leadScoreIdCache = new Map<string, { ids: ResolvedLeadScoreIds; expiresAt: number }>();

async function resolveLeadScoreIds(orgId: string | null | undefined): Promise<ResolvedLeadScoreIds> {
  const cacheKey = orgId ?? "none";
  const cached = leadScoreIdCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.ids;
  }

  const result = await callMcpToolWithTimeout(resolveServerId(orgId), "commonroom_list_objects", {
    objectType: "LeadScore",
    limit: 20,
  });
  const records = (parseMcpToolResult(result) as CommonRoomLeadScoreListResult).records ?? [];

  const find = (predicate: (name: string) => boolean) => {
    const match = records.find((r) => predicate((r.name ?? "").toLowerCase()));
    return normalizeLeadScoreId(match?.id ?? match?.scoreId);
  };

  const ids: ResolvedLeadScoreIds = {
    contactFitId: find((n) => n.includes("contact score")),
    contactIntentId: find((n) => n.includes("contact intent")),
    companyFitId: find((n) => n.includes("company fit score") && !n.includes("v1")),
  };

  leadScoreIdCache.set(cacheKey, { ids, expiresAt: Date.now() + LEAD_SCORE_ID_CACHE_TTL_MS });
  return ids;
}

function extractPercentile(entries: CommonRoomScoreEntry[] | undefined, targetId: string | null): number | null {
  if (!targetId) return null;
  const entry = (entries ?? []).find((e) => e.scoreId != null && normalizeLeadScoreId(e.scoreId) === targetId);
  if (!entry || typeof entry.percentile !== "number" || !Number.isFinite(entry.percentile)) return null;
  return Math.max(0, Math.min(100, Math.round(entry.percentile)));
}

export interface CommonRoomBlendedSignals {
  commonRoomFitScore: number | null;
  commonRoomIntentScore: number | null;
  commonRoomCompanyFitScore: number | null;
}

const NO_SIGNALS: CommonRoomBlendedSignals = {
  commonRoomFitScore: null,
  commonRoomIntentScore: null,
  commonRoomCompanyFitScore: null,
};

// ── Contact detail-drawer enrichment (Task 6) ───────────────────────────────
//
// A SEPARATE Contact lookup from lookupCommonRoomSignals above — same org-
// scoped MCP connection and the exact same best-match fuzzy-identity-matching
// cascade (prefer a companyName match, fall back to a single unambiguous
// result, otherwise no match — never an error), but requesting a different
// set of `properties` for a richer, human-readable enrichment block instead
// of `leadScores` percentiles. These four extra properties are confirmed-real,
// live CommonRoom Contact `allowedColumns`:
//   - recentActivities: "Recent user-initiated activities... id, type,
//     activityTime, content, sentiment, url"
//   - recentWebPages: "Top 5 most visited web pages in the last 12 weeks"
//   - jobHistory: "array of {company, title, startDate, endDate}"
//   - sparkSummary: "AI-generated strategic overview"
// Their exact inner shapes beyond those descriptions can't be verified against
// a live CommonRoom session in this environment, so the caller (get-contact-
// detail.ts) and ContactDrawer.tsx must render defensively rather than assume
// more structure than what's promised above.

export interface CommonRoomContactEnrichment {
  recentActivities: unknown[] | null;
  recentWebPages: unknown[] | null;
  jobHistory: unknown[] | null;
  sparkSummary: string | null;
}

interface CommonRoomEnrichmentContactRecord {
  fullName?: string;
  companyName?: string;
  recentActivities?: unknown;
  recentWebPages?: unknown;
  jobHistory?: unknown;
  sparkSummary?: unknown;
}

interface CommonRoomEnrichmentListResult {
  records?: CommonRoomEnrichmentContactRecord[];
}

export async function lookupCommonRoomContactEnrichment(options: {
  orgId: string | null | undefined;
  fullName: string;
  companyName?: string | null;
}): Promise<CommonRoomContactEnrichment | null> {
  const result = await callMcpToolWithTimeout(resolveServerId(options.orgId), "commonroom_list_objects", {
    objectType: "Contact",
    filter: {
      type: "and",
      clauses: [{ type: "stringFilter", field: "fullName", params: { op: "eq", value: options.fullName } }],
    },
    properties: ["fullName", "companyName", "recentActivities", "recentWebPages", "jobHistory", "sparkSummary"],
    limit: 5,
  });
  const records = (parseMcpToolResult(result) as CommonRoomEnrichmentListResult).records ?? [];
  const companyLower = options.companyName?.toLowerCase().trim() || undefined;
  // Same best-effort match cascade as lookupCommonRoomSignals above: prefer a
  // company match, fall back to a single unambiguous result, otherwise no
  // match (a normal, expected outcome, never an error).
  const match =
    (companyLower
      ? records.find((c) => (c.companyName ?? "").toLowerCase().trim() === companyLower)
      : undefined) ?? (records.length === 1 ? records[0] : undefined);
  if (!match) return null;

  return {
    recentActivities: Array.isArray(match.recentActivities) ? match.recentActivities : null,
    recentWebPages: Array.isArray(match.recentWebPages) ? match.recentWebPages : null,
    jobHistory: Array.isArray(match.jobHistory) ? match.jobHistory : null,
    sparkSummary: typeof match.sparkSummary === "string" ? match.sparkSummary : null,
  };
}

async function lookupContactLeadScores(
  options: { orgId: string | null | undefined; fullName: string; companyName?: string | null },
  ids: { contactFitId: string | null; contactIntentId: string | null },
): Promise<{ commonRoomFitScore: number | null; commonRoomIntentScore: number | null }> {
  const contactResult = await callMcpToolWithTimeout(resolveServerId(options.orgId), "commonroom_list_objects", {
    objectType: "Contact",
    filter: {
      type: "and",
      clauses: [{ type: "stringFilter", field: "fullName", params: { op: "eq", value: options.fullName } }],
    },
    properties: ["fullName", "companyName", "leadScores"],
    limit: 5,
  });
  const contactRecords = (parseMcpToolResult(contactResult) as CommonRoomContactListResult).records ?? [];
  const companyLower = options.companyName?.toLowerCase().trim() || undefined;
  // Same best-effort match cascade as the rest of this app's fuzzy identity
  // matching: prefer a company match, fall back to a single unambiguous
  // result, otherwise no match (not an error).
  const match =
    (companyLower
      ? contactRecords.find((c) => (c.companyName ?? "").toLowerCase().trim() === companyLower)
      : undefined) ?? (contactRecords.length === 1 ? contactRecords[0] : undefined);
  if (!match) return { commonRoomFitScore: null, commonRoomIntentScore: null };
  return {
    commonRoomFitScore: extractPercentile(match.leadScores, ids.contactFitId),
    commonRoomIntentScore: extractPercentile(match.leadScores, ids.contactIntentId),
  };
}

async function lookupCompanyLeadScore(
  options: { orgId: string | null | undefined },
  companyLower: string,
  companyFitId: string,
): Promise<number | null> {
  const orgResult = await callMcpToolWithTimeout(resolveServerId(options.orgId), "commonroom_list_objects", {
    objectType: "Organization",
    filter: {
      type: "and",
      clauses: [{ type: "stringFilter", field: "companyName", params: { op: "eq", value: companyLower } }],
    },
    properties: ["name", "leadScores"],
    limit: 5,
  });
  const orgRecords = (parseMcpToolResult(orgResult) as CommonRoomOrganizationListResult).records ?? [];
  // companyName is an exact-match filter, so a single result is already the
  // disambiguated match; multiple results with no further signal to pick
  // one -> no match (not an error), same discipline as the contact lookup.
  const orgMatch = orgRecords.length === 1 ? orgRecords[0] : undefined;
  return orgMatch ? extractPercentile(orgMatch.leadScores, companyFitId) : null;
}

export async function lookupCommonRoomSignals(options: {
  orgId: string | null | undefined;
  fullName: string;
  companyName?: string | null;
}): Promise<CommonRoomBlendedSignals> {
  const ids = await resolveLeadScoreIds(options.orgId);
  if (!ids.contactFitId && !ids.contactIntentId && !ids.companyFitId) return NO_SIGNALS;

  const companyLower = options.companyName?.trim();

  // These two lookups are fully independent (neither depends on the
  // other's result) but each carries its own 20s MCP timeout ceiling —
  // running them sequentially meant a single contact's worst-case
  // CommonRoom latency was ~40s. With rescore-contacts.ts processing up to
  // RESCORE_CHUNK_SIZE contacts sequentially per request, that was enough
  // to blow past the hosting platform's 75s function timeout on a single
  // batch (live-confirmed: "1 batch had errors: the request took too long
  // and timed out" on a 12-contact chunk). Running them concurrently halves
  // the worst-case per-contact latency.
  const [contactScores, commonRoomCompanyFitScore] = await Promise.all([
    ids.contactFitId || ids.contactIntentId
      ? lookupContactLeadScores(options, { contactFitId: ids.contactFitId, contactIntentId: ids.contactIntentId })
      : Promise.resolve({ commonRoomFitScore: null, commonRoomIntentScore: null }),
    ids.companyFitId && companyLower
      ? lookupCompanyLeadScore(options, companyLower, ids.companyFitId)
      : Promise.resolve(null),
  ]);

  return {
    commonRoomFitScore: contactScores.commonRoomFitScore,
    commonRoomIntentScore: contactScores.commonRoomIntentScore,
    commonRoomCompanyFitScore,
  };
}
