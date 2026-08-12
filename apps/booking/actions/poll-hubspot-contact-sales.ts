import { defineAction } from "@agent-native/core";
import { inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { inboundLeads } from "../server/db/schema.js";
import { hubspotFetch } from "../server/helpers/hubspot-client.js";
import { requireRole } from "../server/helpers/require-role.js";

// Buffer past 24h so a slow/late run (or a run that fails and retries the
// next day) never misses a contact whose contact_sales_date fell in the gap.
// Safe to overlap -- hubspotContactId is the idempotency key below.
const LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

interface HubSpotContactResult {
  id: string;
  properties: {
    firstname?: string;
    lastname?: string;
    email?: string;
    company?: string;
    contact_sales_date?: string;
  };
}

export default defineAction({
  description:
    "Poll HubSpot for contacts who recently submitted the Contact Sales form and record any not already seen.",
  schema: z.object({}),
  requiresAuth: true,
  http: { method: "POST" },
  run: async (_args, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "admin"]);

    const cutoff = Date.now() - LOOKBACK_MS;

    const searchBody = {
      filterGroups: [
        { filters: [{ propertyName: "contact_sales_date", operator: "GTE", value: String(cutoff) }] },
      ],
      properties: ["firstname", "lastname", "email", "company", "contact_sales_date"],
      sorts: [{ propertyName: "contact_sales_date", direction: "DESCENDING" }],
      limit: 100,
    };

    const result = (await hubspotFetch("/crm/v3/objects/contacts/search", {
      method: "POST",
      body: JSON.stringify(searchBody),
    })) as { results?: HubSpotContactResult[] };

    const candidates = result.results ?? [];
    if (candidates.length === 0) {
      return { newLeadsFound: 0 };
    }

    const db = getDb();
    const candidateIds = candidates.map((c) => c.id);
    const existing = await db
      .select({ hubspotContactId: inboundLeads.hubspotContactId })
      .from(inboundLeads)
      .where(inArray(inboundLeads.hubspotContactId, candidateIds));
    const alreadySeen = new Set(existing.map((row) => row.hubspotContactId));

    const fresh = candidates.filter((c) => !alreadySeen.has(c.id));
    if (fresh.length === 0) {
      return { newLeadsFound: 0 };
    }

    const now = new Date().toISOString();
    await db.insert(inboundLeads).values(
      fresh.map((c) => ({
        id: nanoid(),
        hubspotContactId: c.id,
        prospectName: [c.properties.firstname, c.properties.lastname].filter(Boolean).join(" ") || "Unknown",
        prospectEmail: c.properties.email ?? null,
        company: c.properties.company ?? null,
        contactSalesDate: c.properties.contact_sales_date ?? null,
        seen: 0,
        createdAt: now,
      })),
    );

    return { newLeadsFound: fresh.length };
  },
});
