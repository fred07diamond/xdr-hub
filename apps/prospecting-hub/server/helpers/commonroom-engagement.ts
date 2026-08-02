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

async function resolveLeadScoreIds(orgId: string | null | undefined): Promise<ResolvedLeadScoreIds> {
  const result = await callMcpToolWithTimeout(resolveServerId(orgId), "commonroom_list_objects", {
    objectType: "LeadScore",
    limit: 20,
  });
  const records = (parseMcpToolResult(result) as CommonRoomLeadScoreListResult).records ?? [];

  const find = (predicate: (name: string) => boolean) => {
    const match = records.find((r) => predicate((r.name ?? "").toLowerCase()));
    return normalizeLeadScoreId(match?.id ?? match?.scoreId);
  };

  return {
    contactFitId: find((n) => n.includes("contact score")),
    contactIntentId: find((n) => n.includes("contact intent")),
    companyFitId: find((n) => n.includes("company fit score") && !n.includes("v1")),
  };
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

export async function lookupCommonRoomSignals(options: {
  orgId: string | null | undefined;
  fullName: string;
  companyName?: string | null;
}): Promise<CommonRoomBlendedSignals> {
  const ids = await resolveLeadScoreIds(options.orgId);
  if (!ids.contactFitId && !ids.contactIntentId && !ids.companyFitId) return NO_SIGNALS;

  let commonRoomFitScore: number | null = null;
  let commonRoomIntentScore: number | null = null;
  if (ids.contactFitId || ids.contactIntentId) {
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
    // Same best-effort match cascade as the rest of this app's fuzzy
    // identity matching: prefer a company match, fall back to a single
    // unambiguous result, otherwise no match (not an error).
    const match =
      (companyLower
        ? contactRecords.find((c) => (c.companyName ?? "").toLowerCase().trim() === companyLower)
        : undefined) ?? (contactRecords.length === 1 ? contactRecords[0] : undefined);
    if (match) {
      commonRoomFitScore = extractPercentile(match.leadScores, ids.contactFitId);
      commonRoomIntentScore = extractPercentile(match.leadScores, ids.contactIntentId);
    }
  }

  let commonRoomCompanyFitScore: number | null = null;
  const companyLower = options.companyName?.trim();
  if (ids.companyFitId && companyLower) {
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
    // companyName is an exact-match filter, so a single result is already
    // the disambiguated match; multiple results with no further signal to
    // pick one -> no match (not an error), same discipline as the contact
    // lookup above.
    const orgMatch = orgRecords.length === 1 ? orgRecords[0] : undefined;
    if (orgMatch) commonRoomCompanyFitScore = extractPercentile(orgMatch.leadScores, ids.companyFitId);
  }

  return { commonRoomFitScore, commonRoomIntentScore, commonRoomCompanyFitScore };
}
