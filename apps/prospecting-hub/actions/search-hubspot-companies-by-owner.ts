import { defineAction } from "@agent-native/core";
import { hubspotFetchIfConnected } from "@xdr-hub/shared/server";
import { z } from "zod";
import { requireRole } from "../server/helpers/require-role.js";

// HubSpot's companies search endpoint caps a single page at 100 results —
// a single page is fine for v1 (an individual owner's book of accounts is
// well under this in practice); multi-page pagination is intentionally not
// built here.
const MAX_RESULTS = 100;

interface HubSpotCompanyResult {
  id: string;
  properties?: {
    name?: string;
    domain?: string;
    hubspot_owner_id?: string;
    xdr_owner?: string;
  };
}

interface HubSpotCompanySearchResponse {
  results?: HubSpotCompanyResult[];
  total?: number;
}

type MatchedVia = "companyOwner" | "xdrOwner" | "both";

export default defineAction({
  description:
    "Search HubSpot companies owned by a given owner (person), matching on EITHER the native Company owner (hubspot_owner_id) OR the custom xDR Owner (xdr_owner) property — an OR across both fields, not an AND. Read-only, used to browse an AE's or XDR's book of accounts before bulk-adding some as Focus Accounts. Throws if HubSpot isn't connected or the call fails — there's no local fallback for owner-scoped data.",
  schema: z.object({ ownerId: z.string().min(1) }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ ownerId }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);

    let connected: { token: string; data: unknown } | null;
    try {
      // filterGroups entries are OR'd together, filters within one group are
      // ANDed — same semantics search-hubspot-companies.ts already relies on.
      // Two single-filter groups here gives a pure OR across the two owner
      // properties.
      connected = await hubspotFetchIfConnected("/crm/v3/objects/companies/search", {
        method: "POST",
        body: JSON.stringify({
          filterGroups: [
            { filters: [{ propertyName: "hubspot_owner_id", operator: "EQ", value: ownerId }] },
            { filters: [{ propertyName: "xdr_owner", operator: "EQ", value: ownerId }] },
          ],
          properties: ["name", "domain", "hubspot_owner_id", "xdr_owner"],
          limit: MAX_RESULTS,
        }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw Object.assign(new Error(`HubSpot company search failed: ${message}`), { statusCode: 502 });
    }

    if (!connected) {
      throw Object.assign(new Error("HubSpot not connected."), { statusCode: 502 });
    }

    const parsed = connected.data as HubSpotCompanySearchResponse;
    const companies = (parsed.results ?? []).map((r) => {
      const isCompanyOwner = r.properties?.hubspot_owner_id === ownerId;
      const isXdrOwner = r.properties?.xdr_owner === ownerId;
      const matchedVia: MatchedVia = isCompanyOwner && isXdrOwner ? "both" : isXdrOwner ? "xdrOwner" : "companyOwner";
      return {
        id: r.id,
        name: r.properties?.name ?? "(unnamed company)",
        domain: r.properties?.domain ?? null,
        matchedVia,
      };
    });

    // HubSpot's own `total` (the real count matching the filter, independent
    // of this call's page size) lets the UI tell an XDR when this owner's
    // book of business is bigger than the single page fetched here —
    // otherwise "Select all" silently selects only the first MAX_RESULTS
    // companies with no indication anything was left out.
    const total = typeof parsed.total === "number" ? parsed.total : companies.length;
    return { companies, total, truncated: total > companies.length };
  },
});
