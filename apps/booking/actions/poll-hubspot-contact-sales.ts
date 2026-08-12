import { defineAction } from "@agent-native/core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { inboundLeads } from "../server/db/schema.js";
import { hubspotFetch } from "../server/helpers/hubspot-client.js";
import { requireRole } from "../server/helpers/require-role.js";

// Buffer past 24h so a slow/late run (or a run that fails and retries the
// next day) never misses a contact whose most_recent_contact_sales_date fell
// in the gap. Safe to overlap -- (hubspotContactId, contactSalesDate) together
// are the idempotency key below.
const LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

// NOT contact_sales_date ("First Contact Sales Date") -- that only ever gets
// set once, the very first time a contact submits, so a returning contact's
// resubmission would never be detected. most_recent_contact_sales_date
// updates on every submission (confirmed live: a contact whose first-touch
// date was from months ago showed today's date here after resubmitting).
const CONTACT_SALES_PROPERTY = "most_recent_contact_sales_date";

interface HubSpotContactResult {
  id: string;
  properties: {
    firstname?: string;
    lastname?: string;
    email?: string;
    company?: string;
    most_recent_contact_sales_date?: string;
  };
}

export default defineAction({
  description:
    "Poll HubSpot for contacts who recently submitted the Contact Sales form and record any not already seen. Returns the new leads' ids so the caller can action each one.",
  schema: z.object({}),
  requiresAuth: true,
  http: { method: "POST" },
  run: async (_args, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "admin"]);

    const cutoff = Date.now() - LOOKBACK_MS;

    const searchBody = {
      filterGroups: [
        { filters: [{ propertyName: CONTACT_SALES_PROPERTY, operator: "GTE", value: String(cutoff) }] },
      ],
      properties: ["firstname", "lastname", "email", "company", CONTACT_SALES_PROPERTY],
      sorts: [{ propertyName: CONTACT_SALES_PROPERTY, direction: "DESCENDING" }],
      limit: 100,
    };

    const result = (await hubspotFetch("/crm/v3/objects/contacts/search", {
      method: "POST",
      body: JSON.stringify(searchBody),
    })) as { results?: HubSpotContactResult[] };

    const candidates = (result.results ?? [])
      .map((c) => ({ ...c, contactSalesDate: c.properties.most_recent_contact_sales_date ?? null }))
      .filter((c) => c.contactSalesDate);
    if (candidates.length === 0) {
      return { newLeadsFound: 0, newLeadIds: [] as string[] };
    }

    const db = getDb();
    const existing = await db
      .select({ hubspotContactId: inboundLeads.hubspotContactId, contactSalesDate: inboundLeads.contactSalesDate })
      .from(inboundLeads);
    const alreadySeen = new Set(existing.map((row) => `${row.hubspotContactId}::${row.contactSalesDate}`));

    const fresh = candidates.filter((c) => !alreadySeen.has(`${c.id}::${c.contactSalesDate}`));
    if (fresh.length === 0) {
      return { newLeadsFound: 0, newLeadIds: [] as string[] };
    }

    const now = new Date().toISOString();
    const freshRows = fresh.map((c) => ({
      id: nanoid(),
      hubspotContactId: c.id,
      prospectName: [c.properties.firstname, c.properties.lastname].filter(Boolean).join(" ") || "Unknown",
      prospectEmail: c.properties.email ?? null,
      company: c.properties.company ?? null,
      contactSalesDate: c.contactSalesDate,
      seen: 0,
      createdAt: now,
    }));
    await db.insert(inboundLeads).values(freshRows);

    return { newLeadsFound: freshRows.length, newLeadIds: freshRows.map((r) => r.id) };
  },
});
