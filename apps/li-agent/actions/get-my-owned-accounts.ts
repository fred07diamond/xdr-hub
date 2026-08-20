import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getHubSpotToken, hubspotFetch } from "@xdr-hub/shared/server";
import { checkRateLimit } from "../server/helpers/rate-limit.js";

// HubSpot companies search caps a single page at 100 -- same limit
// prospecting-hub's search-hubspot-companies-by-owner.ts already accepts
// for one owner's book of accounts.
const MAX_RESULTS = 100;

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
  };
}

// Powers the "My Accounts" page -- the xDR's own book of business, i.e.
// every HubSpot company where the custom xdr_owner property (an
// OWNER-referencing property, see search-hubspot-companies-by-owner.ts)
// points at them. There was previously no way to answer "which accounts
// are mine" without leaving the app and searching HubSpot by hand, which
// meant there was also no fast way to jump from "my accounts" into a
// LinkedIn Sales Navigator search for people at each one.
export default defineAction({
  description:
    "List HubSpot companies where the custom xDR Owner property (xdr_owner) matches the current user, resolved by matching their app email to a HubSpot owner record. Read-only.",
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

    let searchResult: { results?: HubSpotCompanyResult[]; total?: number } = {};
    try {
      searchResult = (await hubspotFetch("/crm/v3/objects/companies/search", {
        method: "POST",
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: "xdr_owner", operator: "EQ", value: ownerId }] }],
          properties: ["name", "domain", "industry", "numberofemployees"],
          sorts: [{ propertyName: "name", direction: "ASCENDING" }],
          limit: MAX_RESULTS,
        }),
      })) as typeof searchResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw Object.assign(new Error(`HubSpot company search failed: ${message}`), { statusCode: 502 });
    }

    const companies = (searchResult.results ?? []).map((r) => ({
      id: r.id,
      name: r.properties?.name ?? "(unnamed company)",
      domain: r.properties?.domain ?? null,
      industry: r.properties?.industry ?? null,
      employeeCount: r.properties?.numberofemployees ?? null,
    }));

    // Same truncation signal search-hubspot-companies-by-owner.ts uses --
    // HubSpot's own `total` vs. the page actually returned.
    const total = typeof searchResult.total === "number" ? searchResult.total : companies.length;
    return { connected: true, matched: true, companies, total, truncated: total > companies.length };
  },
});
