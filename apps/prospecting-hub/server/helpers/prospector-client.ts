import { callMcpToolWithTimeout, parseMcpToolResult, resolveServerId } from "./commonroom-client.js";

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

// Normalizes a seniority string for loose comparison — CommonRoom's
// documented catalog gives ProspectorContact.seniority examples like
// "director", "manager", "individual_contributor" (lowercase,
// underscore-separated), a DIFFERENT taxonomy than deriveProspectorFilters'
// own SENIORITY_LEVELS ("Intern", "Junior IC", "Senior IC", "Manager",
// "Director", "VP", "C-Level" — the Contact object's memberSeniority
// vocabulary). A strict equality check between the two would silently never
// match. Strip case/spacing/punctuation so "VP" ~ "vp", "C-Level" ~
// "c_level", "Senior IC" loosely matches "individual_contributor" via
// substring overlap on "ic"/"individual" fragments where possible — this is
// necessarily best-effort given the taxonomy mismatch, not an exact mapping.
function normalizeSeniority(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

// Restructured (from a single one-shot call) to support real pagination —
// reaching a target of up to 1000 POST-FILTERED matches can require far more
// than one raw CommonRoom page (each capped at 200 raw records before this
// function's own post-filter narrows that down further), and looping through
// every page needed to reach 1000 inside ONE call would itself risk this
// function's own caller timing out. So this function now fetches exactly ONE
// page per call — passing `cursor` through to CommonRoom and returning its
// own `nextCursor`/`hasMore` pagination fields untouched — and it's the
// CALLER's job (run-sourcing-rule-pipeline.ts) to decide how many pages to
// fetch across however many of its own invocations it takes, following
// `nextCursor` between them.
export async function searchProspectorContacts(options: {
  orgId: string | null | undefined;
  titleKeyword?: string;
  seniority?: string;
  // Manual multi-value overrides (a rule's manualTitleKeywords/
  // manualSeniorities, when the XDR sets them directly instead of relying on
  // the single LLM-derived value above) — when non-empty, these REPLACE
  // titleKeyword/seniority entirely rather than combining with them, since
  // the caller (run-sourcing-rule-pipeline.ts) already resolves which one to
  // use before calling this function. Kept as separate params (rather than
  // just accepting an array for titleKeyword/seniority) so the two existing
  // single-value callers (import-prospects-to-segment.ts,
  // search-commonroom-prospects.ts) need no changes at all.
  titleKeywords?: string[];
  seniorities?: string[];
  // Purely additive filters with no LLM-derived equivalent — always AND'd
  // in on top of whichever title/seniority filter ends up applying.
  minLinkedinFollowers?: number;
  previousCompanyName?: string;
  companyAllowList?: string[];
  companyDenyList?: string[];
  limit: number; // page size hint for THIS ONE call, not the overall target
  cursor?: string;
}): Promise<{ records: ProspectorMatch[]; nextCursor?: string; hasMore: boolean }> {
  const clauses: unknown[] = [];
  const effectiveTitleKeywords = options.titleKeywords?.filter(Boolean) ?? [];
  if (effectiveTitleKeywords.length > 0) {
    // Multiple title keywords are a broadening, not narrowing, control — any
    // one matching is enough — so they're OR'd together as one clause group
    // inside the overall AND filter, same nesting convention as the
    // top-level `{ type: "and", clauses }` below.
    clauses.push({
      type: "or",
      clauses: effectiveTitleKeywords.map((keyword) => ({
        type: "stringFilter",
        field: "title",
        params: { op: "like", value: keyword },
      })),
    });
  } else if (options.titleKeyword) {
    clauses.push({ type: "stringFilter", field: "title", params: { op: "like", value: options.titleKeyword } });
  }
  if (options.previousCompanyName) {
    clauses.push({
      type: "stringFilter",
      field: "previousCompanyName",
      params: { op: "like", value: options.previousCompanyName },
    });
  }
  if (options.minLinkedinFollowers !== undefined) {
    clauses.push({
      type: "numberFilter",
      field: "linkedInFollowerCount",
      params: { op: "gte", value: options.minLinkedinFollowers },
    });
  }
  // NOTE: ProspectorContact has NO "seniority" filter field on CommonRoom's
  // live catalog (confirmed via commonroom_get_catalog — its filters are
  // fullName/title/companyName/companyDomain/locationId/
  // previousCompanyName/previousCompanyDomain/linkedInFollowerCount/
  // lastOrgChange only; "seniority" is a returned/sortable COLUMN, not a
  // filter). Pushing a seniority stringFilter into the MCP call itself
  // throws "Unknown filter field: seniority" — seniority is applied as a
  // post-filter below instead, same as the company allow/deny lists.

  // ProspectorContact has no direct company-list filter matching companyName
  // by name-list, so allow/deny is applied as a post-filter below rather
  // than pushed into the MCP call. Request more than `options.limit` from
  // the MCP call itself (3x, capped at 200 — CommonRoom's own apparent
  // per-call ceiling) to leave headroom for the post-filter to still return
  // close to the requested count for THIS page.
  const mcpLimit = Math.min(200, Math.max(1, options.limit * 3));

  const result = await callMcpToolWithTimeout(resolveServerId(options.orgId), "commonroom_list_objects", {
    objectType: "ProspectorContact",
    ...(clauses.length > 0 ? { filter: { type: "and", clauses } } : {}),
    properties: PROSPECTOR_PROPERTIES,
    limit: mcpLimit,
    ...(options.cursor ? { cursor: options.cursor } : {}),
  });

  const parsed = parseMcpToolResult(result) as ProspectorListResult;
  const records = parsed.records ?? [];

  const allowList = options.companyAllowList?.map((c) => c.toLowerCase()).filter(Boolean);
  const denyList = options.companyDenyList?.map((c) => c.toLowerCase()).filter(Boolean);
  const effectiveSeniorities = (options.seniorities?.filter(Boolean) ?? []).map(normalizeSeniority);
  const normalizedSeniority =
    effectiveSeniorities.length === 0 && options.seniority ? normalizeSeniority(options.seniority) : null;

  const filtered = records.filter((record) => {
    const company = record.companyName?.toLowerCase();
    if (allowList && allowList.length > 0) {
      if (!company || !allowList.includes(company)) return false;
    }
    if (denyList && denyList.length > 0) {
      if (company && denyList.includes(company)) return false;
    }
    if (effectiveSeniorities.length > 0) {
      const recordSeniority = record.seniority ? normalizeSeniority(record.seniority) : "";
      const matchesAny =
        !!recordSeniority &&
        effectiveSeniorities.some((s) => recordSeniority.includes(s) || s.includes(recordSeniority));
      if (!matchesAny) return false;
    } else if (normalizedSeniority) {
      const recordSeniority = record.seniority ? normalizeSeniority(record.seniority) : "";
      if (!recordSeniority || (!recordSeniority.includes(normalizedSeniority) && !normalizedSeniority.includes(recordSeniority))) {
        return false;
      }
    }
    return true;
  });

  // `hasMore`/`nextCursor` describe CommonRoom's OWN raw pagination state —
  // whether it has more raw records beyond this page — independent of how
  // many of THIS page's records survived the post-filter above. Slicing the
  // post-filtered results to `options.limit` (this page's own size hint)
  // mirrors the pre-pagination behavior exactly for every single-page caller
  // (import-prospects-to-segment.ts, search-commonroom-prospects.ts); the
  // multi-page caller (run-sourcing-rule-pipeline.ts) always passes a
  // `limit` sized to what it still needs for the current page, so this slice
  // is never a real cap on its overall target.
  return {
    records: filtered.slice(0, options.limit),
    nextCursor: parsed.nextCursor,
    hasMore: parsed.has_more ?? false,
  };
}

export interface ProspectorCompanyMatch {
  id: string;
  name?: string;
  primaryWebsite?: string;
  employees?: number;
  subIndustry?: string;
}

interface ProspectorCompanyListResult {
  total: number;
  count: number;
  nextCursor?: string;
  has_more: boolean;
  records: ProspectorCompanyMatch[];
}

const PROSPECTOR_COMPANY_PROPERTIES = ["name", "primaryWebsite", "employees", "subIndustry"];

// ProspectorCompany is CommonRoom's company-level Prospector object type —
// same MCP tool/objectType pattern as searchProspectorContacts above, but
// qualifying companies against an ICP's firmographic criteria (industry,
// headcount) rather than contacts against a persona's title/seniority
// criteria. This object type has NOT been live-tested this session — the
// filter shape (groupSubIndustry stringListFilter, groupCompanySize
// numberFilter) is best-effort based on CommonRoom's documented catalog,
// not something verifiable without a live MCP connection.
export async function searchProspectorCompanies(options: {
  orgId: string | null | undefined;
  industryKeyword?: string;
  minEmployees?: number;
  limit: number;
}): Promise<{ total: number; records: ProspectorCompanyMatch[] }> {
  const clauses: unknown[] = [];
  if (options.industryKeyword) {
    clauses.push({
      type: "stringListFilter",
      field: "groupSubIndustry",
      params: { op: "any", value: [options.industryKeyword] },
    });
  }
  if (options.minEmployees !== undefined) {
    clauses.push({
      type: "numberFilter",
      field: "groupCompanySize",
      params: { op: "gte", value: options.minEmployees },
    });
  }

  const result = await callMcpToolWithTimeout(resolveServerId(options.orgId), "commonroom_list_objects", {
    objectType: "ProspectorCompany",
    ...(clauses.length > 0 ? { filter: { type: "and", clauses } } : {}),
    properties: PROSPECTOR_COMPANY_PROPERTIES,
    limit: options.limit,
  });

  const parsed = parseMcpToolResult(result) as ProspectorCompanyListResult;
  const records = parsed.records ?? [];

  return { total: parsed.total ?? records.length, records: records.slice(0, options.limit) };
}
