import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { prospects } from "../server/db/schema.js";
import { getHubSpotToken, hubspotFetch } from "@xdr-hub/shared/server";
import { resolveOwnerStrict } from "../server/helpers/resolve-owner.js";
import { checkRateLimit } from "../server/helpers/rate-limit.js";

export default defineAction({
  description: "Check if a prospect exists in HubSpot and return their CRM status, owner, warm signals, and a direct link to their contact record.",
  schema: z.object({
    profileUrl: z.string().describe("LinkedIn profile URL to look up"),
    name: z.string().nullish().describe("Full name scraped from the LinkedIn profile (used when not yet in DB)"),
    company: z.string().nullish().describe("Company name scraped from the LinkedIn profile (used when not yet in DB)"),
    apiToken: z.string().nullish().describe("Personal API token"),
  }),
  requiresAuth: false,
  readOnly: true,
  http: { method: "GET" },
  publicAgent: { expose: true, readOnly: true, requiresAuth: false },
  run: async ({ profileUrl, name: nameParam, company: companyParam, apiToken }, ctx) => {
    const token = await getHubSpotToken();
    if (!token) return { connected: false, found: false };

    // A real session or a valid personal token is required — this searches
    // the org's live HubSpot data, so a credential-free caller gets nothing
    // rather than being silently treated as the workspace owner.
    const ownerEmail = await resolveOwnerStrict(apiToken, ctx);
    if (!ownerEmail) return { connected: false, found: false };

    if (!(await checkRateLimit(ownerEmail, "check-hubspot-contact", 120))) {
      return { connected: false, found: false };
    }

    // Try DB first — gives us stored name/company and lets us scope by owner.
    const db = getDb();
    const rows = await db
      .select()
      .from(prospects)
      .where(eq(prospects.profileUrl, profileUrl))
      .limit(1);
    const prospect = rows[0];

    // Scope to the requesting user when we have a DB record with an owner set.
    if (prospect && ownerEmail && prospect.ownerEmail && prospect.ownerEmail !== ownerEmail) {
      return { connected: true, found: false };
    }

    // Resolve name/company: prefer DB values, fall back to params passed from the extension scrape.
    const resolvedName = (prospect?.name ?? nameParam ?? "").trim();
    const resolvedCompany = (prospect?.company ?? companyParam ?? "").trim();

    // Nothing to search with — profile not captured yet and no scrape data passed.
    if (!resolvedName) return { connected: true, found: false };

    const nameParts = resolvedName.split(/\s+/);
    const firstName = nameParts[0] ?? "";
    const lastName = nameParts.slice(1).join(" ").toLowerCase();
    const companyLower = resolvedCompany.toLowerCase();

    const SEARCH_PROPERTIES = [
      "firstname", "lastname", "company", "lifecyclestage", "hs_lead_status",
      "email", "hubspot_owner_id", "message",
      "hs_analytics_first_url", "hs_analytics_last_url",
      "hs_sequences_is_enrolled", "hs_latest_sequence_enrolled",
      "xdr_owner",
    ];

    // Build filter groups (OR'd in HubSpot). Prefer narrower filters first so
    // the most precise match wins without needing a high limit.
    const filterGroups: Array<{ filters: Array<{ propertyName: string; operator: string; value: string }> }> = [];
    if (lastName) {
      // firstname AND lastname: most precise, handles the "many Simons" case.
      filterGroups.push({
        filters: [
          { propertyName: "firstname", operator: "EQ", value: firstName },
          { propertyName: "lastname", operator: "EQ", value: lastName },
        ],
      });
    }
    if (resolvedCompany) {
      // firstname AND company: useful when lastname differs or missing.
      filterGroups.push({
        filters: [
          { propertyName: "firstname", operator: "EQ", value: firstName },
          { propertyName: "company", operator: "CONTAINS_TOKEN", value: resolvedCompany },
        ],
      });
    }
    if (!filterGroups.length) {
      // Last resort: firstname only (low signal, but better than nothing).
      filterGroups.push({ filters: [{ propertyName: "firstname", operator: "EQ", value: firstName }] });
    }

    let searchResult: { results?: Array<{ id: string; properties: Record<string, string> }> } = {};
    try {
      searchResult = (await hubspotFetch("/crm/v3/objects/contacts/search", {
        method: "POST",
        body: JSON.stringify({ filterGroups, properties: SEARCH_PROPERTIES, limit: 10 }),
      })) as typeof searchResult;
    } catch {
      return { connected: true, found: false };
    }

    const results = searchResult.results ?? [];

    const match =
      // Best: first + last + company all match
      results.find(
        (r) =>
          (r.properties.lastname ?? "").toLowerCase() === lastName &&
          companyLower &&
          (r.properties.company ?? "").toLowerCase() === companyLower,
      ) ??
      // Good: first + last match (company may be stored differently in HubSpot)
      results.find(
        (r) => lastName && (r.properties.lastname ?? "").toLowerCase() === lastName,
      ) ??
      // Fallback: first + company match
      results.find(
        (r) => companyLower && (r.properties.company ?? "").toLowerCase() === companyLower,
      ) ??
      // Last resort: only one result for this first name
      (results.length === 1 ? results[0] : undefined);

    if (!match) {
      return { connected: true, found: false };
    }

    // Get portal ID to construct the direct HubSpot link (best-effort)
    let portalId: number | null = null;
    try {
      const info = (await hubspotFetch("/account-info/v3/details")) as { portalId?: number };
      portalId = info.portalId ?? null;
    } catch { /* best-effort */ }

    const hubspotUrl = portalId
      ? `https://app.hubspot.com/contacts/${portalId}/contact/${match.id}`
      : null;

    // Resolve owner name from ownerId (best-effort)
    const ownerId = match.properties.hubspot_owner_id ?? null;
    let ownerName: string | null = null;
    if (ownerId) {
      try {
        const ownerRes = (await hubspotFetch(`/crm/v3/owners/${ownerId}`)) as {
          firstName?: string;
          lastName?: string;
          email?: string;
        };
        const parts = [ownerRes.firstName, ownerRes.lastName].filter(Boolean);
        ownerName = parts.length ? parts.join(" ") : (ownerRes.email ?? null);
      } catch { /* best-effort */ }
    }

    // Best-effort deal lookup
    let deals: Array<{ name: string; stage: string }> = [];
    try {
      const assoc = (await hubspotFetch(
        `/crm/v3/objects/contacts/${match.id}/associations/deals?limit=5`,
      )) as { results?: Array<{ id: string }> };
      if (assoc.results?.length) {
        const dealBatch = (await hubspotFetch("/crm/v3/objects/deals/batch/read", {
          method: "POST",
          body: JSON.stringify({
            inputs: assoc.results.map((d) => ({ id: d.id })),
            properties: ["dealname", "dealstage"],
          }),
        })) as { results?: Array<{ properties: Record<string, string> }> };
        deals = (dealBatch.results ?? []).map((d) => ({
          name: d.properties.dealname ?? "",
          stage: d.properties.dealstage ?? "",
        }));
      }
    } catch {
      // deals are best-effort; continue without them
    }

    return {
      connected: true,
      found: true,
      contactId: match.id,
      hubspotUrl,
      ownerName,
      xdrOwner: match.properties.xdr_owner || null,
      email: match.properties.email ?? null,
      formMessage: match.properties.message ?? null,
      firstPageSeen: match.properties.hs_analytics_first_url ?? null,
      lastPageSeen: match.properties.hs_analytics_last_url ?? null,
      isInSequence: match.properties.hs_sequences_is_enrolled === "true",
      contact: {
        lifecycleStage: match.properties.lifecyclestage ?? "",
        leadStatus: match.properties.hs_lead_status ?? "",
      },
      deals,
    };
  },
});
