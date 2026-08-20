import { getHubSpotToken, hubspotFetch } from "@xdr-hub/shared/server";
import { buildCompanyTags, resolveCompanyTagProperties, type CompanyTag } from "./hubspot-company-tags.js";

// HubSpot's companies search caps a single page at 100, so a book of
// business larger than that needs real cursor pagination -- unlike
// prospecting-hub's search-hubspot-companies-by-owner.ts, which
// deliberately accepts one page. Here the whole list is the point, so this
// pages through and returns everything up to a hard ceiling.
const PAGE_LIMIT = 100;
const MAX_PAGES = 20; // hard stop so a pathological paging loop can't run away (2000 companies)

export type MatchedVia = "companyOwner" | "xdrOwner" | "both";

export interface OwnedAccount {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employeeCount: string | null;
  matchedVia: MatchedVia;
  tags: CompanyTag[];
  // HubSpot's own rollup of the most recent activity logged against this
  // company (including activity on its associated contacts). Used to rank
  // "my most active accounts".
  lastActivityAt: string | null;
}

export type OwnedAccountsResult =
  | { status: "notConnected" }
  | { status: "noOwnerRecord" }
  | { status: "ok"; accounts: OwnedAccount[]; total: number; truncated: boolean };

interface HubSpotCompanyResult {
  id: string;
  // Open-ended: tag properties are resolved at runtime per portal (see
  // hubspot-company-tags.ts), so this bag holds whatever was requested.
  properties?: Record<string, string | undefined>;
}

// Shared by the My Accounts page (get-my-owned-accounts.ts) and the AI
// search assistant (generate-sales-nav-search.ts), which needs the same
// book of accounts to resolve requests like "my top accounts by activity".
//
// xDRs and AEs are attributed differently in HubSpot: an xDR via the
// custom xdr_owner property, an AE via the native Company owner
// (hubspot_owner_id) -- so this ORs across both, same semantics
// prospecting-hub's search-hubspot-companies-by-owner.ts established.
export async function fetchOwnedAccounts(userEmail: string): Promise<OwnedAccountsResult> {
  const token = await getHubSpotToken();
  if (!token) return { status: "notConnected" };

  // xdr_owner stores an owner id, not an email -- resolve this user's own
  // HubSpot owner record by email first (GET /crm/v3/owners supports an
  // `email` query param for an exact match).
  let ownerId: string | null = null;
  try {
    const ownerRes = (await hubspotFetch(`/crm/v3/owners?email=${encodeURIComponent(userEmail)}`)) as {
      results?: Array<{ id?: string; archived?: boolean }>;
    };
    ownerId = (ownerRes.results ?? []).find((o) => !o.archived && o.id)?.id ?? null;
  } catch {
    // fall through -- reported as noOwnerRecord below
  }
  if (!ownerId) return { status: "noOwnerRecord" };

  // Resolved once per call, then reused for every page -- these are
  // portal-level property definitions, not per-company data.
  const tagProperties = await resolveCompanyTagProperties();
  const BASE_PROPERTIES = [
    "name",
    "domain",
    "industry",
    "numberofemployees",
    "hubspot_owner_id",
    "xdr_owner",
    "notes_last_updated",
  ];
  const requestedProperties = [...BASE_PROPERTIES, ...tagProperties.map((t) => t.propertyName)];

  const rawResults: HubSpotCompanyResult[] = [];
  let reportedTotal: number | null = null;
  let after: string | undefined;
  let page = 0;
  try {
    for (;;) {
      const body: Record<string, unknown> = {
        // filterGroups entries are OR'd together, filters within one group
        // are ANDed -- two single-filter groups gives a pure OR across the
        // two owner properties.
        filterGroups: [
          { filters: [{ propertyName: "hubspot_owner_id", operator: "EQ", value: ownerId }] },
          { filters: [{ propertyName: "xdr_owner", operator: "EQ", value: ownerId }] },
        ],
        properties: requestedProperties,
        sorts: [{ propertyName: "name", direction: "ASCENDING" }],
        limit: PAGE_LIMIT,
      };
      if (after) body.after = after;
      const res = (await hubspotFetch("/crm/v3/objects/companies/search", {
        method: "POST",
        body: JSON.stringify(body),
      })) as { results?: HubSpotCompanyResult[]; total?: number; paging?: { next?: { after?: string } } };

      rawResults.push(...(res.results ?? []));
      if (reportedTotal === null && typeof res.total === "number") reportedTotal = res.total;
      page++;
      after = res.paging?.next?.after;
      if (!after || page >= MAX_PAGES) break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw Object.assign(new Error(`HubSpot company search failed: ${message}`), { statusCode: 502 });
  }

  const accounts: OwnedAccount[] = rawResults.map((r) => {
    const isCompanyOwner = r.properties?.hubspot_owner_id === ownerId;
    const isXdrOwner = r.properties?.xdr_owner === ownerId;
    const matchedVia: MatchedVia = isCompanyOwner && isXdrOwner ? "both" : isXdrOwner ? "xdrOwner" : "companyOwner";
    return {
      id: r.id,
      name: r.properties?.name ?? "(unnamed company)",
      domain: r.properties?.domain ?? null,
      industry: r.properties?.industry ?? null,
      employeeCount: r.properties?.numberofemployees ?? null,
      matchedVia,
      tags: buildCompanyTags(r.properties ?? {}, tagProperties),
      lastActivityAt: r.properties?.notes_last_updated ?? null,
    };
  });

  // HubSpot's own `total` (the real count matching the filter) vs. what
  // paging actually returned -- only differs if MAX_PAGES capped it.
  const total = reportedTotal ?? accounts.length;
  return { status: "ok", accounts, total, truncated: total > accounts.length };
}

export type AccountRankBy = "activity" | "employees" | "name";

// Ranks a book of accounts for "top N accounts by ..." requests.
//
// "activity" uses HubSpot's notes_last_updated rollup -- the most RECENT
// activity on the account, which is the only activity signal available
// without an extra per-contact query for every account. Accounts with no
// activity sort last rather than being treated as recent.
export function rankAccounts(accounts: OwnedAccount[], rankBy: AccountRankBy): OwnedAccount[] {
  const sorted = [...accounts];
  if (rankBy === "activity") {
    sorted.sort((a, b) => {
      if (!a.lastActivityAt && !b.lastActivityAt) return a.name.localeCompare(b.name);
      if (!a.lastActivityAt) return 1;
      if (!b.lastActivityAt) return -1;
      return b.lastActivityAt.localeCompare(a.lastActivityAt);
    });
  } else if (rankBy === "employees") {
    sorted.sort((a, b) => {
      const an = Number(a.employeeCount);
      const bn = Number(b.employeeCount);
      const aOk = Number.isFinite(an);
      const bOk = Number.isFinite(bn);
      if (!aOk && !bOk) return a.name.localeCompare(b.name);
      if (!aOk) return 1;
      if (!bOk) return -1;
      return bn - an;
    });
  } else {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  }
  return sorted;
}

// Matches a free-text tag reference from a prompt ("Tier 1", "tier one",
// "churned") against an account's real tag values. Substring + case
// insensitive on purpose: the model echoes the user's wording, which
// rarely matches HubSpot's exact enum label.
export function accountMatchesTagQuery(account: OwnedAccount, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return account.tags.some((t) => {
    const value = t.value.toLowerCase();
    const label = t.label.toLowerCase();
    return value.includes(q) || q.includes(value) || `${label}: ${value}`.includes(q);
  });
}
