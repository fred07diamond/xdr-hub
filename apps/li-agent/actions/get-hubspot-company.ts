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

    const COMPANY_PROPERTIES = ["name", "domain", "industry", "numberofemployees", "country", "hubspot_owner_id"];

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

    let ownerName: string | null = null;
    const ownerId = match.properties.hubspot_owner_id ?? null;
    if (ownerId) {
      try {
        const ownerRes = (await hubspotFetch(`/crm/v3/owners/${ownerId}`)) as {
          firstName?: string;
          lastName?: string;
          email?: string;
        };
        const parts = [ownerRes.firstName, ownerRes.lastName].filter(Boolean);
        ownerName = parts.length ? parts.join(" ") : (ownerRes.email ?? null);
      } catch {
        // best-effort
      }
    }

    // Best-effort deal lookup -- a scope/permission gap here shouldn't blank
    // out company info that did resolve.
    let deals: Array<{ name: string; stage: string; amount: string | null; closeDate: string | null }> = [];
    try {
      const assoc = (await hubspotFetch(
        `/crm/v4/objects/companies/${match.id}/associations/deals`,
      )) as { results?: Array<{ toObjectId: string }> };
      const ids = (assoc.results ?? []).map((r) => r.toObjectId).slice(0, 10);
      if (ids.length) {
        const batch = (await hubspotFetch("/crm/v3/objects/deals/batch/read", {
          method: "POST",
          body: JSON.stringify({ inputs: ids.map((id) => ({ id })), properties: ["dealname", "dealstage", "amount", "closedate"] }),
        })) as { results?: Array<{ properties: Record<string, string> }> };
        deals = (batch.results ?? []).map((d) => ({
          name: d.properties.dealname ?? "",
          stage: d.properties.dealstage ?? "",
          amount: d.properties.amount ?? null,
          closeDate: d.properties.closedate ?? null,
        }));
      }
    } catch {
      // deals are best-effort; continue without them
    }

    // Best-effort contact lookup -- "who else has been in touch at this company."
    let contacts: Array<{ name: string; title: string | null; email: string | null }> = [];
    try {
      const assoc = (await hubspotFetch(
        `/crm/v4/objects/companies/${match.id}/associations/contacts`,
      )) as { results?: Array<{ toObjectId: string }> };
      const ids = (assoc.results ?? []).map((r) => r.toObjectId).slice(0, 10);
      if (ids.length) {
        const batch = (await hubspotFetch("/crm/v3/objects/contacts/batch/read", {
          method: "POST",
          body: JSON.stringify({ inputs: ids.map((id) => ({ id })), properties: ["firstname", "lastname", "jobtitle", "email"] }),
        })) as { results?: Array<{ properties: Record<string, string> }> };
        contacts = (batch.results ?? []).map((c) => ({
          name: [c.properties.firstname, c.properties.lastname].filter(Boolean).join(" ") || "(no name)",
          title: c.properties.jobtitle ?? null,
          email: c.properties.email ?? null,
        }));
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
        ownerName,
      },
      deals,
      contacts,
    };
  },
});
