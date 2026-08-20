import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getHubSpotToken, hubspotFetch } from "@xdr-hub/shared/server";
import { checkRateLimit } from "../server/helpers/rate-limit.js";

// Powers the Prospects table's Company column hover card and ProspectSheet's
// Company section (same action, same query key, so react-query naturally
// dedupes if a row was already hovered before being clicked). Read-only --
// mirrors check-hubspot-contact.ts's associations->batch/read pattern, just
// scoped to the company object instead of the contact.
export default defineAction({
  description:
    "Look up a company in HubSpot by domain (preferred) or name, returning company info plus its associated deals and contacts.",
  schema: z.object({
    companyDomain: z.string().nullish(),
    companyName: z.string().nullish(),
  }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ companyDomain, companyName }, ctx) => {
    const token = await getHubSpotToken();
    if (!token) return { connected: false, matched: false };

    if (!(await checkRateLimit(ctx?.userEmail ?? "anonymous", "get-hubspot-company", 120))) {
      return { connected: true, matched: false, error: "Rate limit reached — try again shortly." };
    }

    if (!companyDomain && !companyName) return { connected: true, matched: false };

    // hubspot_owner_id (Company owner) and xdr_owner (custom xDR Owner) are
    // both real, live-verified OWNER-referencing properties on the Company
    // object -- see search-hubspot-companies-by-owner.ts in prospecting-hub.
    const COMPANY_PROPERTIES = ["name", "domain", "industry", "numberofemployees", "country", "hubspot_owner_id", "xdr_owner"];

    let searchResult: { results?: Array<{ id: string; properties: Record<string, string> }> } = {};
    try {
      const filterGroups = companyDomain
        ? [{ filters: [{ propertyName: "domain", operator: "EQ", value: companyDomain }] }]
        : [{ filters: [{ propertyName: "name", operator: "CONTAINS_TOKEN", value: companyName! }] }];
      searchResult = (await hubspotFetch("/crm/v3/objects/companies/search", {
        method: "POST",
        body: JSON.stringify({ filterGroups, properties: COMPANY_PROPERTIES, limit: 1 }),
      })) as typeof searchResult;
    } catch {
      return { connected: true, matched: false };
    }

    const match = searchResult.results?.[0];
    if (!match) return { connected: true, matched: false };

    // Portal ID for the direct record link (best-effort). 0-2 is HubSpot's
    // built-in object-type id for Company, same convention as prospecting-
    // hub's hubspot-contact-lookup.ts.
    let portalId: number | null = null;
    try {
      const info = (await hubspotFetch("/account-info/v3/details")) as { portalId?: number };
      portalId = info.portalId ?? null;
    } catch {
      // best-effort
    }
    const recordUrl = portalId ? `https://app.hubspot.com/contacts/${portalId}/record/0-2/${match.id}` : null;

    const resolveOwnerName = async (ownerId: string | null | undefined): Promise<string | null> => {
      if (!ownerId) return null;
      try {
        const ownerRes = (await hubspotFetch(`/crm/v3/owners/${ownerId}`)) as {
          firstName?: string;
          lastName?: string;
          email?: string;
        };
        const parts = [ownerRes.firstName, ownerRes.lastName].filter(Boolean);
        return parts.length ? parts.join(" ") : (ownerRes.email ?? null);
      } catch {
        return null; // best-effort
      }
    };
    const companyOwnerId = match.properties.hubspot_owner_id ?? null;
    const xdrOwnerId = match.properties.xdr_owner ?? null;
    const [companyOwnerName, xdrOwnerNameResolved] = await Promise.all([
      resolveOwnerName(companyOwnerId),
      // Same owner list, but often a different person -- only re-fetch if the
      // ids actually differ.
      xdrOwnerId === companyOwnerId ? Promise.resolve(null) : resolveOwnerName(xdrOwnerId),
    ]);
    const xdrOwnerName = xdrOwnerId === companyOwnerId ? companyOwnerName : xdrOwnerNameResolved;

    // Best-effort deal lookup -- a scope/permission gap here shouldn't blank
    // out company info that did resolve. hs_is_closed/hs_is_closed_won are
    // HubSpot's own calculated deal properties -- using them instead of
    // parsing dealstage avoids assuming any particular pipeline's stage ids.
    let openDeals: Array<{ name: string; amount: string | null; closeDate: string | null }> = [];
    let closedLostDeals: Array<{ name: string; amount: string | null; closeDate: string | null }> = [];
    try {
      const assoc = (await hubspotFetch(
        `/crm/v4/objects/companies/${match.id}/associations/deals`,
      )) as { results?: Array<{ toObjectId: string }> };
      const ids = (assoc.results ?? []).map((r) => r.toObjectId).slice(0, 25);
      if (ids.length) {
        const batch = (await hubspotFetch("/crm/v3/objects/deals/batch/read", {
          method: "POST",
          body: JSON.stringify({
            inputs: ids.map((id) => ({ id })),
            properties: ["dealname", "amount", "closedate", "hs_is_closed", "hs_is_closed_won"],
          }),
        })) as { results?: Array<{ properties: Record<string, string> }> };
        for (const d of batch.results ?? []) {
          const deal = {
            name: d.properties.dealname ?? "",
            amount: d.properties.amount ?? null,
            closeDate: d.properties.closedate ?? null,
          };
          const isClosed = d.properties.hs_is_closed === "true";
          const isWon = d.properties.hs_is_closed_won === "true";
          if (!isClosed) openDeals.push(deal);
          else if (!isWon) closedLostDeals.push(deal);
          // closed-won deals aren't shown here -- not requested.
        }
      }
    } catch {
      // deals are best-effort; continue without them
    }

    // Best-effort contact lookup -- "top prospects based on activity" ranks
    // this company's contacts by HubSpot's own last-activity signal
    // (notes_last_updated), most recent first, so the busiest relationship
    // surfaces first instead of an arbitrary association order.
    let topProspects: Array<{ name: string; title: string | null; email: string | null; lastActivityAt: string | null }> = [];
    try {
      const assoc = (await hubspotFetch(
        `/crm/v4/objects/companies/${match.id}/associations/contacts`,
      )) as { results?: Array<{ toObjectId: string }> };
      const ids = (assoc.results ?? []).map((r) => r.toObjectId).slice(0, 25);
      if (ids.length) {
        const batch = (await hubspotFetch("/crm/v3/objects/contacts/batch/read", {
          method: "POST",
          body: JSON.stringify({
            inputs: ids.map((id) => ({ id })),
            properties: ["firstname", "lastname", "jobtitle", "email", "notes_last_updated"],
          }),
        })) as { results?: Array<{ properties: Record<string, string> }> };
        topProspects = (batch.results ?? [])
          .map((c) => ({
            name: [c.properties.firstname, c.properties.lastname].filter(Boolean).join(" ") || "(no name)",
            title: c.properties.jobtitle ?? null,
            email: c.properties.email ?? null,
            lastActivityAt: c.properties.notes_last_updated ?? null,
          }))
          .sort((a, b) => {
            if (!a.lastActivityAt && !b.lastActivityAt) return 0;
            if (!a.lastActivityAt) return 1;
            if (!b.lastActivityAt) return -1;
            return b.lastActivityAt.localeCompare(a.lastActivityAt);
          });
      }
    } catch {
      // contacts are best-effort; continue without them
    }

    return {
      connected: true,
      matched: true,
      recordUrl,
      company: {
        name: match.properties.name ?? companyName ?? null,
        domain: match.properties.domain ?? companyDomain ?? null,
        industry: match.properties.industry ?? null,
        employeeCount: match.properties.numberofemployees ?? null,
        country: match.properties.country ?? null,
        companyOwnerName,
        xdrOwnerName,
      },
      openDeals,
      closedLostDeals,
      topProspects,
    };
  },
});
