import { callMcpTool } from "@agent-native/core/mcp-client";
import { parseMcpToolResult, resolveServerId } from "./commonroom-client.js";

// CommonRoom "LeadScore" engagement lookup, reusing the exact same
// org-scoped MCP connection as the rest of commonroom-client.ts /
// prospector-client.ts / icp-filters.ts. Mirrors the exact best-match/
// no-match fuzzy-identity-matching discipline
// apps/li-agent/actions/check-hubspot-contact.ts already establishes for
// this same class of problem: cascading fallbacks from most-specific match
// down to a single-result fallback, with "not found" treated as a normal
// outcome rather than an error.
//
// NOT LIVE-TESTED THIS SESSION — this needs a live MCP session this task
// doesn't have. Controller-verify-only: the literal call shapes below
// (objectType/filter/properties) should be sanity-checked against real
// CommonRoom data before relying on this in production.

interface CommonRoomLeadScoreRecord {
  id?: string;
  scoreId?: string;
}

interface CommonRoomLeadScoreListResult {
  records?: CommonRoomLeadScoreRecord[];
}

interface CommonRoomContactLeadScoreEntry {
  scoreId?: string;
  percentile?: number;
}

interface CommonRoomEngagementContact {
  id?: string;
  fullName?: string;
  companyName?: string;
  leadScores?: CommonRoomContactLeadScoreEntry[];
}

interface CommonRoomContactListResult {
  records?: CommonRoomEngagementContact[];
}

export async function lookupCommonRoomEngagement(options: {
  orgId: string | null | undefined;
  fullName: string;
  companyName?: string | null;
}): Promise<number | null> {
  // Step 1: find a configured LeadScore id. `commonroom_list_objects` with
  // objectType "LeadScore", no filter, small limit. A room with no
  // LeadScore configured is a normal, expected state — return null
  // immediately rather than treating it as an error.
  const leadScoreResult = await callMcpTool(resolveServerId(options.orgId), "commonroom_list_objects", {
    objectType: "LeadScore",
    limit: 5,
  });
  const leadScoreRecords = (parseMcpToolResult(leadScoreResult) as CommonRoomLeadScoreListResult).records ?? [];
  const leadScoreId = leadScoreRecords[0]?.id ?? leadScoreRecords[0]?.scoreId;
  if (!leadScoreId) return null;

  // Step 2: look up the Contact by full name. `commonroom_list_objects` with
  // objectType "Contact", a stringFilter on fullName (op "eq", per the
  // catalog's own description this is case-insensitive), requesting
  // fullName/companyName/leadScores, small limit.
  const contactResult = await callMcpTool(resolveServerId(options.orgId), "commonroom_list_objects", {
    objectType: "Contact",
    filter: {
      type: "and",
      clauses: [{ type: "stringFilter", field: "fullName", params: { op: "eq", value: options.fullName } }],
    },
    properties: ["fullName", "companyName", "leadScores"],
    limit: 5,
  });
  const contactRecords = (parseMcpToolResult(contactResult) as CommonRoomContactListResult).records ?? [];
  if (contactRecords.length === 0) return null;

  const companyLower = options.companyName?.toLowerCase().trim() || undefined;

  // Step 3: best-effort match — same cascading discipline as
  // check-hubspot-contact.ts: prefer a company match, fall back to a single
  // unambiguous result, otherwise no match (not an error).
  const match =
    (companyLower
      ? contactRecords.find((c) => (c.companyName ?? "").toLowerCase().trim() === companyLower)
      : undefined) ?? (contactRecords.length === 1 ? contactRecords[0] : undefined);
  if (!match) return null;

  // Step 4: find the leadScores entry for the configured score id.
  const entry = (match.leadScores ?? []).find((s) => s.scoreId === leadScoreId);
  if (!entry || typeof entry.percentile !== "number" || !Number.isFinite(entry.percentile)) return null;

  return Math.max(0, Math.min(100, Math.round(entry.percentile)));
}
