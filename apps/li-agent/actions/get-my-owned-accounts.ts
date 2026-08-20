import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getHubSpotToken, hubspotFetch } from "@xdr-hub/shared/server";
import { checkRateLimit } from "../server/helpers/rate-limit.js";

// HubSpot's companies search caps a single page at 100, so a book of
// business larger than that needs real cursor pagination -- unlike
// prospecting-hub's search-hubspot-companies-by-owner.ts, which
// deliberately accepts one page. Here the whole list is the point (it's
// the user's own account list, and they page/filter it client-side the
// same way the Prospects table does), so this pages through and returns
// everything up to a hard ceiling.
const PAGE_LIMIT = 100;
const MAX_PAGES = 20; // hard stop so a pathological paging loop can't run away (2000 companies)

interface HubSpotOwner {
  id?: string;
  archived?: boolean;
}

interface HubSpotCompanyResult {
  id: string;
  properties?: {
    name?: string;
    domain?: string;
    industry?: string;
    numberofemployees?: string;
    hubspot_owner_id?: string;
    xdr_owner?: string;
  };
}

type MatchedVia = "companyOwner" | "xdrOwner" | "both";

// Powers the "My Accounts" page -- a user's own book of business. xDRs and
// AEs are attributed differently in HubSpot: an xDR shows up via the
// custom xdr_owner property, an AE via the native Company owner
// (hubspot_owner_id) -- same OR-across-both-properties semantics already
// established in prospecting-hub's search-hubspot-companies-by-owner.ts.
// There was previously no way to answer "which accounts are mine" without
// leaving the app and searching HubSpot by hand, which meant there was
// also no fast way to jump from "my accounts" into a LinkedIn Sales
// Navigator search for people at each one.
export default defineAction({
  description:
    "List HubSpot companies where the current user is either the Company owner (hubspot_owner_id, the AE-facing property) or the custom xDR Owner (xdr_owner) -- an OR across both, resolved by matching their app email to a HubSpot owner record. Read-only.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_input, ctx) => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) return { connected: false, matched: false, companies: [], total: 0 };

    const token = await getHubSpotToken();
    if (!token) return { connected: false, matched: false, companies: [], total: 0 };

    if (!(await checkRateLimit(userEmail, "get-my-owned-accounts", 60))) {
      return { connected: true, matched: false, companies: [], total: 0, error: "Rate limit reached -- try again shortly." };
    }

    // xdr_owner stores an owner id, not an email -- resolve this xDR's own
    // HubSpot owner record by email first (GET /crm/v3/owners supports an
    // `email` query param for an exact match).
    let ownerId: string | null = null;
    try {
      const ownerRes = (await hubspotFetch(`/crm/v3/owners?email=${encodeURIComponent(userEmail)}`)) as {
        results?: HubSpotOwner[];
      };
      const match = (ownerRes.results ?? []).find((o) => !o.archived && o.id);
      ownerId = match?.id ?? null;
    } catch {
      // fall through -- reported as noOwnerRecord below
    }

    if (!ownerId) {
      return { connected: true, matched: false, companies: [], total: 0, noOwnerRecord: true };
    }

    const rawResults: HubSpotCompanyResult[] = [];
    let reportedTotal: number | null = null;
    let after: string | undefined;
    let page = 0;
    try {
      for (;;) {
        const body: Record<string, unknown> = {
          // filterGroups entries are OR'd together, filters within one
          // group are ANDed -- two single-filter groups here gives a pure
          // OR across the two owner properties, same semantics
          // search-hubspot-companies-by-owner.ts already relies on.
          filterGroups: [
            { filters: [{ propertyName: "hubspot_owner_id", operator: "EQ", value: ownerId }] },
            { filters: [{ propertyName: "xdr_owner", operator: "EQ", value: ownerId }] },
          ],
          properties: ["name", "domain", "industry", "numberofemployees", "hubspot_owner_id", "xdr_owner"],
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

    const companies = rawResults.map((r) => {
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
      };
    });

    // HubSpot's own `total` (the real count matching the filter) vs. what
    // paging actually returned -- only differs now if MAX_PAGES capped it,
    // which the UI surfaces rather than silently hiding.
    const total = reportedTotal ?? companies.length;
    return { connected: true, matched: true, companies, total, truncated: total > companies.length };
  },
});
