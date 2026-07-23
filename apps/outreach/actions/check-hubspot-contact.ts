import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { prospects } from "../server/db/schema.js";
import { getHubSpotToken, hubspotFetch } from "../server/helpers/hubspot-client.js";

export default defineAction({
  description: "Check if a prospect exists in HubSpot and return their CRM status.",
  schema: z.object({ prospectId: z.string() }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ prospectId }) => {
    const token = await getHubSpotToken();
    if (!token) return { connected: false, found: false };

    const db = getDb();
    const rows = await db.select().from(prospects).where(eq(prospects.id, prospectId));
    const prospect = rows[0];
    if (!prospect) return { connected: true, found: false };

    const nameParts = (prospect.name ?? "").trim().split(/\s+/);
    const firstName = nameParts[0] ?? "";

    let searchResult: { results?: Array<{ id: string; properties: Record<string, string> }> } = {};
    try {
      searchResult = (await hubspotFetch("/crm/v3/objects/contacts/search", {
        method: "POST",
        body: JSON.stringify({
          filterGroups: [
            { filters: [{ propertyName: "firstname", operator: "EQ", value: firstName }] },
          ],
          properties: ["firstname", "lastname", "company", "lifecyclestage", "hs_lead_status"],
          limit: 5,
        }),
      })) as typeof searchResult;
    } catch {
      return { connected: true, found: false };
    }

    const results = searchResult.results ?? [];
    const lastName = nameParts.slice(1).join(" ").toLowerCase();
    const company = (prospect.company ?? "").toLowerCase();

    // Prefer result where both last name and company match; fall back to first result
    const match =
      results.find(
        (r) =>
          (r.properties.lastname ?? "").toLowerCase() === lastName &&
          (r.properties.company ?? "").toLowerCase() === company,
      ) ??
      results.find((r) => (r.properties.company ?? "").toLowerCase() === company) ??
      results[0];

    if (!match) return { connected: true, found: false };

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
      contact: {
        lifecycleStage: match.properties.lifecyclestage ?? "",
        leadStatus: match.properties.hs_lead_status ?? "",
      },
      deals,
    };
  },
});
