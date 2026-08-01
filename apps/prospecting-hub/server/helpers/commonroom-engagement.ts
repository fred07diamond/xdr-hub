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
// Live-verified against a real CommonRoom workspace (by the task
// controller, who has MCP access this task doesn't): the fullName
// exact-match Contact lookup and the company-based best-match
// disambiguation (steps 2-3 below) both work correctly as written. The
// LeadScore selection (step 1) and scoreId comparison (step 4) below were
// fixed based on that live verification — see the inline comments at each
// site for the exact real-world shapes that drove the fix.

interface CommonRoomLeadScoreRecord {
  id?: string;
  scoreId?: string;
  name?: string;
}

interface CommonRoomLeadScoreListResult {
  records?: CommonRoomLeadScoreRecord[];
}

interface CommonRoomContactLeadScoreEntry {
  // Confirmed live: a matched Contact's leadScores[].scoreId comes back as a
  // bare NUMBER (e.g. 17351), unlike the "ls_"-prefixed STRING id the
  // LeadScore list itself returns (e.g. "ls_17351") — see the normalization
  // in lookupCommonRoomEngagement below.
  scoreId?: number;
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
  // Step 1: find a configured contact-level LeadScore id. `commonroom_list_objects`
  // with objectType "LeadScore", no filter, small limit.
  //
  // Confirmed live: a real room has SEVERAL LeadScores configured at once,
  // mixing contact-level ones (e.g. "Contact Intent Score", "Contact Score
  // V2") with org/account-level ones (e.g. "Organization Score V2", "ABX
  // Account Prioritization") — real Contact records' `leadScores` arrays
  // only ever contain entries for the contact-level ids, never the
  // org-level ones. The catalog exposes no explicit entity-type field, so
  // `name` containing "contact" (case-insensitive) is the only available
  // signal to pick a contact-level score instead of blindly taking
  // records[0] (which would silently land on an org-level score that will
  // NEVER appear on a Contact, making this always return null for the
  // wrong reason).
  const leadScoreResult = await callMcpTool(resolveServerId(options.orgId), "commonroom_list_objects", {
    objectType: "LeadScore",
    limit: 5,
  });
  const leadScoreRecords = (parseMcpToolResult(leadScoreResult) as CommonRoomLeadScoreListResult).records ?? [];
  const contactLeadScore = leadScoreRecords.find((r) => (r.name ?? "").toLowerCase().includes("contact"));
  const rawLeadScoreId = contactLeadScore?.id ?? contactLeadScore?.scoreId;
  // No contact-level LeadScore configured on this room — normal, expected
  // state, not an error.
  if (!rawLeadScoreId) return null;

  // LeadScore ids come back as "ls_"-prefixed strings (e.g. "ls_17351"), but
  // a Contact's leadScores[].scoreId comes back as a bare number (e.g.
  // 17351, no prefix) — see CommonRoomContactLeadScoreEntry above.
  // Normalize both sides to a bare numeric string explicitly here so the
  // step-4 comparison below can't silently never-match on a type/format
  // mismatch.
  const leadScoreId = String(rawLeadScoreId).replace(/^ls_/, "");

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

  // Step 4: find the leadScores entry for the configured score id. Compare
  // as bare numeric strings on both sides — see the normalization note at
  // `leadScoreId` above for why a strict `===` on the raw values would
  // never match.
  const entry = (match.leadScores ?? []).find((s) => s.scoreId != null && String(s.scoreId) === leadScoreId);
  if (!entry || typeof entry.percentile !== "number" || !Number.isFinite(entry.percentile)) return null;

  return Math.max(0, Math.min(100, Math.round(entry.percentile)));
}
