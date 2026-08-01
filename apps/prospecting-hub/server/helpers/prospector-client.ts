import { callMcpTool } from "@agent-native/core/mcp-client";
import { parseMcpToolResult, resolveServerId } from "./commonroom-client.js";

// CommonRoom Prospector contacts are queried through the exact same
// org-scoped MCP connection as the rest of commonroom-client.ts (the vendor
// exposes Prospector data as another `objectType` on the same
// `commonroom_list_objects` tool) — hence reusing `resolveServerId` and
// `parseMcpToolResult` directly rather than duplicating them.

export interface ProspectorMatch {
  id: string;
  fullName?: string;
  title?: string;
  companyName?: string;
  companyWebsite?: string;
  location?: { country?: string };
  seniority?: string;
  role?: string;
  skills?: string[];
  linkedInHandle?: string;
  linkedInFollowerCount?: number;
}

interface ProspectorListResult {
  total: number;
  count: number;
  nextCursor?: string;
  has_more: boolean;
  records: ProspectorMatch[];
}

const PROSPECTOR_PROPERTIES = [
  "fullName",
  "title",
  "companyName",
  "companyWebsite",
  "location",
  "seniority",
  "role",
  "skills",
  "linkedInHandle",
  "linkedInFollowerCount",
];

export async function searchProspectorContacts(options: {
  orgId: string | null | undefined;
  titleKeyword?: string;
  seniority?: string;
  companyAllowList?: string[];
  companyDenyList?: string[];
  limit: number;
}): Promise<{ total: number; records: ProspectorMatch[] }> {
  const clauses: unknown[] = [];
  if (options.titleKeyword) {
    clauses.push({ type: "stringFilter", field: "title", params: { op: "like", value: options.titleKeyword } });
  }
  if (options.seniority) {
    clauses.push({ type: "stringFilter", field: "seniority", params: { op: "eq", value: options.seniority } });
  }

  // ProspectorContact has no direct company-list filter matching companyName
  // by name-list, so allow/deny is applied as a post-filter below rather
  // than pushed into the MCP call. Request more than `options.limit` from
  // the MCP call itself (3x, capped at 200) to leave headroom for the
  // post-filter to still return close to the requested count.
  const mcpLimit = Math.min(200, options.limit * 3);

  const result = await callMcpTool(resolveServerId(options.orgId), "commonroom_list_objects", {
    objectType: "ProspectorContact",
    ...(clauses.length > 0 ? { filter: { type: "and", clauses } } : {}),
    properties: PROSPECTOR_PROPERTIES,
    limit: mcpLimit,
  });

  const parsed = parseMcpToolResult(result) as ProspectorListResult;
  const records = parsed.records ?? [];

  const allowList = options.companyAllowList?.map((c) => c.toLowerCase()).filter(Boolean);
  const denyList = options.companyDenyList?.map((c) => c.toLowerCase()).filter(Boolean);

  const filtered = records.filter((record) => {
    const company = record.companyName?.toLowerCase();
    if (allowList && allowList.length > 0) {
      if (!company || !allowList.includes(company)) return false;
    }
    if (denyList && denyList.length > 0) {
      if (company && denyList.includes(company)) return false;
    }
    return true;
  });

  return { total: parsed.total ?? filtered.length, records: filtered.slice(0, options.limit) };
}
