import { completeText, getRequestContext, runWithRequestContext } from "@agent-native/core/server";
import { eq } from "@agent-native/core/db/schema";
import { getDb } from "../db/index.js";
import { icps } from "../db/schema.js";
import { decodePersonaCriteria } from "./persona-sync.js";
import { searchProspectorCompanies, type ProspectorCompanyMatch } from "./prospector-client.js";

export interface DerivedIcpCompanyFilters {
  industryKeyword: string | null;
  minEmployees: number | null;
}

// One completeText() call, factored into a plain function (not inline in the
// action) so search-icp-companies.ts and, eventually, Task 14's scheduled
// pipeline can call it directly instead of making a nested action-to-action
// HTTP hop — same reasoning as deriveProspectorFilters in
// derive-prospector-filters.ts. Grounded only in the ICP's raw criteria
// text: proposes an industry keyword and/or a minimum employee count ONLY
// if the text actually states or clearly implies them — never invents a
// value the doc doesn't support.
export async function deriveIcpCompanyFilters(icpText: string): Promise<DerivedIcpCompanyFilters> {
  const systemPrompt =
    "You read an ICP (Ideal Customer Profile) document's criteria text and propose CommonRoom Prospector company-search parameters for qualifying companies against it, for a sales team's outbound prospecting pipeline.\n\n" +
    `ICP criteria:\n${icpText.slice(0, 4000)}\n\n` +
    "Propose:\n" +
    '- industryKeyword: a short industry or sub-industry keyword (e.g. "Fintech") that best captures the target industry this ICP describes, or null if the criteria text says or implies any industry is fine. Base this ONLY on what the criteria text actually says — never invent an industry the doc doesn\'t support.\n' +
    '- minEmployees: a minimum employee-count number if the criteria text states or clearly implies one (e.g. "500+ employees" -> 500), or null if no headcount threshold is given — never guess a number the doc doesn\'t support.\n\n' +
    'Reply with valid JSON only: { "industryKeyword": "<string or null>", "minEmployees": <number or null> }';

  // deriveIcpCompanyFilters intentionally takes only the raw text (no
  // userEmail/orgId) so Task 14's scheduled pipeline can call it without
  // threading per-request identity through. Reuse the ambient request
  // context when one is already active (the search-icp-companies.ts
  // action-route case) so this nested wrap doesn't clobber real
  // userEmail/orgId with undefined; fall back to an empty context so
  // completeText still has an AsyncLocalStorage scope to read when called
  // from a non-request context (e.g. a cron job) with no ambient context at all.
  const call = () => completeText({ systemPrompt, input: "Derive ICP company-search parameters.", maxOutputTokens: 200 });
  const result = await runWithRequestContext(getRequestContext() ?? {}, call);

  const raw = result.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Unparseable ICP company filter response: ${raw.slice(0, 200)}`);
  }

  const industryKeyword =
    typeof parsed.industryKeyword === "string" && parsed.industryKeyword.trim() ? parsed.industryKeyword.trim() : null;
  const minEmployees =
    typeof parsed.minEmployees === "number" && Number.isFinite(parsed.minEmployees) && parsed.minEmployees > 0
      ? parsed.minEmployees
      : null;

  return { industryKeyword, minEmployees };
}

// Loads the ICP row, decodes its criteria, derives company-search filters
// from it, then runs the CommonRoom ProspectorCompany search. Factored as a
// plain function (mirroring how deriveProspectorFilters's action is a thin
// wrapper around its helper) so search-icp-companies.ts and Task 14's
// pipeline can both call it directly without an action-to-action HTTP hop.
export async function searchIcpCompanies(options: {
  icpId: string;
  userEmail: string;
  orgId?: string | null;
  limit: number;
}): Promise<{ total: number; records: ProspectorCompanyMatch[] }> {
  const db = getDb();

  const icpRows = await db
    .select({ id: icps.id, name: icps.name, criteria: icps.criteria })
    .from(icps)
    .where(eq(icps.id, options.icpId))
    .limit(1);
  const icp = icpRows[0];
  if (!icp) {
    throw Object.assign(new Error(`ICP ${options.icpId} not found.`), { statusCode: 404 });
  }

  const criteriaText = decodePersonaCriteria(icp.criteria);
  if (!criteriaText) {
    throw new Error(`ICP ${options.icpId} has no criteria text to derive company filters from.`);
  }

  // Establish request context from searchIcpCompanies's own real userEmail/
  // orgId params before calling deriveIcpCompanyFilters, one call frame up
  // — deriveIcpCompanyFilters's brief-mandated signature (icpText only)
  // can't take them directly, and its internal `getRequestContext() ?? {}`
  // reuse is only a safety net for the case where a context already
  // exists (the action-route path). Without this, Task 14's future
  // cron-triggered call to searchIcpCompanies would have no ambient
  // context at all, deriveIcpCompanyFilters's fallback would establish an
  // EMPTY context, and completeText() would silently resolve no
  // user-scoped key/attribution instead of the real caller's.
  const filters = await runWithRequestContext(
    { userEmail: options.userEmail, orgId: options.orgId ?? undefined },
    () => deriveIcpCompanyFilters(criteriaText),
  );

  return searchProspectorCompanies({
    orgId: options.orgId,
    industryKeyword: filters.industryKeyword ?? undefined,
    minEmployees: filters.minEmployees ?? undefined,
    limit: options.limit,
  });
}
