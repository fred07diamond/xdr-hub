import { hubspotFetchWithTimeout } from "./hubspot-client.js";

// Shared HubSpot "companies owned by this owner" lookup -- the same query
// was independently implemented twice: apps/li-agent/server/helpers/owned-
// accounts.ts's fetchOwnedAccounts() (full cursor pagination, since a rep's
// whole book of business is the point there) and apps/prospecting-hub/
// actions/search-hubspot-companies-by-owner.ts (deliberately a single page,
// "fine for v1" per its own comment). This adopts li-agent's richer,
// paginated implementation as canonical since a sourcing/marketing rule
// pinned to an owner needs the OWNER'S FULL BOOK, not just the first 100.
//
// li-agent's own fetchOwnedAccounts() is untouched by this -- it also joins
// in portal-specific company tags (hubspot-company-tags.ts) and activity
// ranking, which are My Accounts UI concerns with no equivalent need here.
// This helper only covers the base owner-matched company list both apps
// actually share.

const PAGE_LIMIT = 100;
const MAX_PAGES = 20; // hard stop so a pathological paging loop can't run away (2000 companies)

export type OwnedCompanyMatchedVia = "companyOwner" | "xdrOwner" | "both";

export interface OwnedCompany {
  id: string;
  name: string;
  domain: string | null;
  matchedVia: OwnedCompanyMatchedVia;
}

export interface OwnedCompaniesResult {
  companies: OwnedCompany[];
  total: number;
  truncated: boolean;
}

interface HubSpotCompanyResult {
  id: string;
  properties?: { name?: string; domain?: string; hubspot_owner_id?: string; xdr_owner?: string };
}

/** Resolve a HubSpot owner id from this user's email via GET /crm/v3/owners. Null if no active owner record matches. */
export async function resolveHubSpotOwnerIdByEmail(userEmail: string): Promise<string | null> {
  const res = (await hubspotFetchWithTimeout(`/crm/v3/owners?email=${encodeURIComponent(userEmail)}`)) as {
    results?: Array<{ id?: string; archived?: boolean }>;
  };
  return (res.results ?? []).find((o) => !o.archived && o.id)?.id ?? null;
}

/**
 * Every company owned by `ownerId`, matching on EITHER the native Company
 * owner (hubspot_owner_id) OR the custom xDR Owner (xdr_owner) property --
 * an OR across both fields, since xDRs and AEs are attributed differently.
 * Pages through up to MAX_PAGES; `truncated` is true only if that cap was
 * hit (HubSpot's own `total` still reports the real, uncapped count).
 */
export async function fetchCompaniesByOwner(ownerId: string): Promise<OwnedCompaniesResult> {
  const rawResults: HubSpotCompanyResult[] = [];
  let reportedTotal: number | null = null;
  let after: string | undefined;
  let page = 0;

  for (;;) {
    const body: Record<string, unknown> = {
      // filterGroups entries are OR'd together, filters within one group are
      // ANDed -- two single-filter groups gives a pure OR across the two
      // owner properties.
      filterGroups: [
        { filters: [{ propertyName: "hubspot_owner_id", operator: "EQ", value: ownerId }] },
        { filters: [{ propertyName: "xdr_owner", operator: "EQ", value: ownerId }] },
      ],
      properties: ["name", "domain", "hubspot_owner_id", "xdr_owner"],
      sorts: [{ propertyName: "name", direction: "ASCENDING" }],
      limit: PAGE_LIMIT,
    };
    if (after) body.after = after;

    const res = (await hubspotFetchWithTimeout("/crm/v3/objects/companies/search", {
      method: "POST",
      body: JSON.stringify(body),
    })) as { results?: HubSpotCompanyResult[]; total?: number; paging?: { next?: { after?: string } } };

    rawResults.push(...(res.results ?? []));
    if (reportedTotal === null && typeof res.total === "number") reportedTotal = res.total;
    page++;
    after = res.paging?.next?.after;
    if (!after || page >= MAX_PAGES) break;
  }

  const companies: OwnedCompany[] = rawResults.map((r) => {
    const isCompanyOwner = r.properties?.hubspot_owner_id === ownerId;
    const isXdrOwner = r.properties?.xdr_owner === ownerId;
    const matchedVia: OwnedCompanyMatchedVia = isCompanyOwner && isXdrOwner ? "both" : isXdrOwner ? "xdrOwner" : "companyOwner";
    return {
      id: r.id,
      name: r.properties?.name ?? "(unnamed company)",
      domain: r.properties?.domain ?? null,
      matchedVia,
    };
  });

  const total = reportedTotal ?? companies.length;
  return { companies, total, truncated: total > companies.length };
}
