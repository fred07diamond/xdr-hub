import { defineAction } from "@agent-native/core";
import { eq, and } from "@agent-native/core/db/schema";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { contacts, syncRecords } from "../server/db/schema.js";
import { hubspotFetch } from "@xdr-hub/shared/server";
import { requireRole } from "../server/helpers/require-role.js";
import { logAnalyticsEvent } from "../server/helpers/analytics.js";

const CONTACT_PROPERTIES = ["firstname", "lastname", "jobtitle", "company", "email", "phone", "hs_linkedin_url"];
// Hard cap per run so a single sync can't run away — matches the pattern
// import-hubspot-queue.ts already uses (IMPORT_LIMIT) for the same reason.
const MAX_CONTACTS_PER_RUN = 1000;
const PAGE_SIZE = 100;

interface HubSpotContact {
  id: string;
  properties: Record<string, string | undefined>;
}

export default defineAction({
  description: "Pull contacts from HubSpot into the local contact pool (read-only). Paginates up to a hard cap per run.",
  schema: z.object({
    limit: z.number().int().min(1).max(MAX_CONTACTS_PER_RUN).default(500),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ limit }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();
    const syncId = nanoid();
    const startedAt = new Date().toISOString();

    await db.insert(syncRecords).values({
      id: syncId,
      source: "hubspot",
      startedAt,
      status: "running",
    });

    try {
      // Portal ID for constructing direct HubSpot links (best-effort).
      let portalId: number | null = null;
      try {
        const info = (await hubspotFetch("/account-info/v3/details")) as { portalId?: number };
        portalId = info.portalId ?? null;
      } catch { /* best-effort */ }

      const pulled: HubSpotContact[] = [];
      let after: string | undefined;
      while (pulled.length < limit) {
        const pageSize = Math.min(PAGE_SIZE, limit - pulled.length);
        const params = new URLSearchParams({
          limit: String(pageSize),
          properties: CONTACT_PROPERTIES.join(","),
        });
        if (after) params.set("after", after);

        const page = (await hubspotFetch(`/crm/v3/objects/contacts?${params.toString()}`)) as {
          results?: HubSpotContact[];
          paging?: { next?: { after?: string } };
        };
        const results = page.results ?? [];
        pulled.push(...results);

        after = page.paging?.next?.after;
        if (!after || results.length === 0) break;
      }

      const now = new Date().toISOString();
      let created = 0;
      let updated = 0;

      for (const hsContact of pulled) {
        const p = hsContact.properties;
        const name = [p.firstname, p.lastname].filter(Boolean).join(" ").trim();
        if (!name) continue; // skip contacts with no name at all — nothing useful to sort

        const existing = await db
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(eq(contacts.externalId, hsContact.id), eq(contacts.source, "hubspot")))
          .limit(1);

        const hubspotUrl = portalId ? `https://app.hubspot.com/contacts/${portalId}/contact/${hsContact.id}` : null;

        if (existing[0]) {
          await db
            .update(contacts)
            .set({
              name,
              title: p.jobtitle ?? null,
              company: p.company ?? null,
              email: p.email ?? null,
              phone: p.phone ?? null,
              linkedinUrl: p.hs_linkedin_url ?? null,
              hubspotUrl,
              syncedAt: now,
              updatedAt: now,
            })
            .where(eq(contacts.id, existing[0].id));
          updated++;
        } else {
          await db.insert(contacts).values({
            id: nanoid(),
            name,
            title: p.jobtitle ?? null,
            company: p.company ?? null,
            email: p.email ?? null,
            phone: p.phone ?? null,
            linkedinUrl: p.hs_linkedin_url ?? null,
            hubspotUrl,
            source: "hubspot",
            externalId: hsContact.id,
            status: "active",
            syncedAt: now,
            createdAt: now,
            updatedAt: now,
          });
          created++;
        }
      }

      await db
        .update(syncRecords)
        .set({ status: "success", completedAt: new Date().toISOString(), recordsPulled: pulled.length })
        .where(eq(syncRecords.id, syncId));

      await logAnalyticsEvent(ctx!.userEmail!, "sync_run", { source: "hubspot", status: "success", recordsPulled: pulled.length });

      return { syncId, status: "success" as const, recordsPulled: pulled.length, created, updated };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(syncRecords)
        .set({ status: "failed", completedAt: new Date().toISOString(), error: message })
        .where(eq(syncRecords.id, syncId));
      await logAnalyticsEvent(ctx!.userEmail!, "sync_run", { source: "hubspot", status: "failed", recordsPulled: 0 });
      throw Object.assign(new Error(`HubSpot sync failed: ${message}`), { statusCode: 502 });
    }
  },
});
