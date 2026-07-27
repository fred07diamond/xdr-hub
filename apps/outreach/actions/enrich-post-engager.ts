// apps/outreach/actions/enrich-post-engager.ts
import { defineAction } from "@agent-native/core";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { postEngagements } from "../server/db/schema.js";
import { resolveOwner } from "../server/helpers/resolve-owner.js";
import { scoreEngager } from "../server/helpers/score-engager.js";
import { buildProfileSummary, selectPersona } from "../server/helpers/select-persona.js";
import { getHubSpotToken, hubspotFetch } from "../server/helpers/hubspot-client.js";

export default defineAction({
  description: "Update a post engager with full LinkedIn profile data, then run HubSpot lookup and ICP fit scoring synchronously.",
  schema: z.object({
    id: z.string().describe("Engager record id from ingest-post-engager"),
    headline: z.string().nullish(),
    role: z.string().nullish(),
    about: z.string().nullish(),
    recentActivity: z.string().nullish(),
    apiToken: z.string().nullish(),
  }),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: false, requiresAuth: false },
  run: async (args, ctx) => {
    const db = getDb();
    const now = new Date().toISOString();
    const ownerEmail = await resolveOwner(args.apiToken, ctx);
    const ownerFilter = ownerEmail
      ? eq(postEngagements.ownerEmail, ownerEmail)
      : isNull(postEngagements.ownerEmail);

    const rows = await db
      .select()
      .from(postEngagements)
      .where(and(eq(postEngagements.id, args.id), ownerFilter))
      .limit(1);

    if (!rows[0]) return { ok: false, error: "Engager not found" };
    const row = rows[0];

    // Save enriched profile fields and set status to enriching.
    await db.update(postEngagements)
      .set({
        engagerHeadline: args.headline ?? null,
        engagerRole: args.role ?? null,
        engagerAbout: args.about ?? null,
        engagerRecentActivity: args.recentActivity ?? null,
        status: "enriching",
        updatedAt: now,
      })
      .where(eq(postEngagements.id, args.id));

    // HubSpot lookup — reuse the same search logic as check-hubspot-contact.
    let xdrOwner: string | null = null;
    let contactOwner: string | null = null;
    let hubspotStatus: "found" | "new_opportunity" = "new_opportunity";

    const token = getHubSpotToken();
    if (token && row.engagerName) {
      try {
        const nameParts = row.engagerName.trim().split(/\s+/);
        const firstName = nameParts[0] ?? "";
        const lastName = nameParts.slice(1).join(" ").toLowerCase();
        const companyLower = (row.engagerCompany ?? "").toLowerCase();

        const filterGroups: Array<{ filters: Array<{ propertyName: string; operator: string; value: string }> }> = [];
        if (lastName) {
          filterGroups.push({
            filters: [
              { propertyName: "firstname", operator: "EQ", value: firstName },
              { propertyName: "lastname", operator: "EQ", value: lastName },
            ],
          });
        }
        if (row.engagerCompany) {
          filterGroups.push({
            filters: [
              { propertyName: "firstname", operator: "EQ", value: firstName },
              { propertyName: "company", operator: "CONTAINS_TOKEN", value: row.engagerCompany },
            ],
          });
        }
        if (!filterGroups.length) {
          filterGroups.push({ filters: [{ propertyName: "firstname", operator: "EQ", value: firstName }] });
        }

        const searchResult = (await hubspotFetch("/crm/v3/objects/contacts/search", {
          method: "POST",
          body: JSON.stringify({
            filterGroups,
            properties: ["firstname", "lastname", "company", "hubspot_owner_id", "xdr_owner"],
            limit: 10,
          }),
        })) as { results?: Array<{ id: string; properties: Record<string, string> }> };

        const results = searchResult.results ?? [];
        const match =
          results.find(r =>
            (r.properties.lastname ?? "").toLowerCase() === lastName &&
            companyLower && (r.properties.company ?? "").toLowerCase() === companyLower,
          ) ??
          results.find(r => lastName && (r.properties.lastname ?? "").toLowerCase() === lastName) ??
          results.find(r => companyLower && (r.properties.company ?? "").toLowerCase() === companyLower) ??
          (results.length === 1 ? results[0] : undefined);

        if (match) {
          hubspotStatus = "found";
          xdrOwner = match.properties.xdr_owner || null;

          const ownerId = match.properties.hubspot_owner_id ?? null;
          if (ownerId) {
            try {
              const ownerRes = (await hubspotFetch(`/crm/v3/owners/${ownerId}`)) as {
                firstName?: string; lastName?: string; email?: string;
              };
              const parts = [ownerRes.firstName, ownerRes.lastName].filter(Boolean);
              contactOwner = parts.length ? parts.join(" ") : (ownerRes.email ?? null);
            } catch { /* best-effort */ }
          }
        }
      } catch { /* HubSpot lookup is best-effort */ }
    }

    // Set status to scoring before the LLM call.
    await db.update(postEngagements)
      .set({ status: "scoring", xdrOwner, contactOwner, hubspotStatus, updatedAt: new Date().toISOString() })
      .where(eq(postEngagements.id, args.id));

    // Build profile summary for scoring.
    const profileData = {
      name: row.engagerName,
      headline: args.headline ?? null,
      role: args.role ?? null,
      company: row.engagerCompany ?? null,
      about: args.about ?? null,
      recentActivity: args.recentActivity ?? null,
      profileUrl: row.engagerProfileUrl,
    };
    const { icpText } = await selectPersona(db, profileData);
    const profileSummary = buildProfileSummary(profileData);

    const { fitVerdict, fitReason } = await scoreEngager({
      icpText,
      profileSummary,
      commentText: row.commentText ?? null,
    });

    const doneAt = new Date().toISOString();
    await db.update(postEngagements)
      .set({ fitVerdict, fitReason, status: "done", updatedAt: doneAt })
      .where(eq(postEngagements.id, args.id));

    return { ok: true, id: args.id, fitVerdict, fitReason, hubspotStatus, xdrOwner, status: "done" as const };
  },
});
