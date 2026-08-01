import { defineAction } from "@agent-native/core";
import { and, eq, sql } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { analyticsEvents, contacts, syncRecords } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Return summary analytics (segments created, contacts actioned, sync runs, contacts by source) for the dashboard.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_input, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    const thirtyDaysAgoIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [
      [segmentsCreatedTotal],
      [segmentsCreatedLast30],
      [contactsActionedTotal],
      [contactsActionedLast30],
      [syncRunsTotal],
      [syncRunsSuccess],
      [syncRunsFailed],
      [syncRunsHubspot],
      [syncRunsCommonroom],
      [contactsHubspotActive],
      [contactsCommonroomActive],
      [contactsProspectorActive],
    ] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)` })
        .from(analyticsEvents)
        .where(eq(analyticsEvents.eventType, "segment_created")),
      db
        .select({ count: sql<number>`count(*)` })
        .from(analyticsEvents)
        .where(
          and(
            eq(analyticsEvents.eventType, "segment_created"),
            sql`${analyticsEvents.timestamp} >= ${thirtyDaysAgoIso}`,
          ),
        ),
      db
        .select({ count: sql<number>`count(*)` })
        .from(analyticsEvents)
        .where(eq(analyticsEvents.eventType, "contact_actioned")),
      db
        .select({ count: sql<number>`count(*)` })
        .from(analyticsEvents)
        .where(
          and(
            eq(analyticsEvents.eventType, "contact_actioned"),
            sql`${analyticsEvents.timestamp} >= ${thirtyDaysAgoIso}`,
          ),
        ),
      db.select({ count: sql<number>`count(*)` }).from(syncRecords),
      db
        .select({ count: sql<number>`count(*)` })
        .from(syncRecords)
        .where(eq(syncRecords.status, "success")),
      db
        .select({ count: sql<number>`count(*)` })
        .from(syncRecords)
        .where(eq(syncRecords.status, "failed")),
      db
        .select({ count: sql<number>`count(*)` })
        .from(syncRecords)
        .where(eq(syncRecords.source, "hubspot")),
      db
        .select({ count: sql<number>`count(*)` })
        .from(syncRecords)
        .where(eq(syncRecords.source, "commonroom")),
      db
        .select({ count: sql<number>`count(*)` })
        .from(contacts)
        .where(and(eq(contacts.source, "hubspot"), eq(contacts.status, "active"))),
      db
        .select({ count: sql<number>`count(*)` })
        .from(contacts)
        .where(and(eq(contacts.source, "commonroom"), eq(contacts.status, "active"))),
      db
        .select({ count: sql<number>`count(*)` })
        .from(contacts)
        .where(and(eq(contacts.source, "prospector"), eq(contacts.status, "active"))),
    ]);

    return {
      segmentsCreated: {
        total: Number(segmentsCreatedTotal?.count ?? 0),
        last30Days: Number(segmentsCreatedLast30?.count ?? 0),
      },
      contactsActioned: {
        total: Number(contactsActionedTotal?.count ?? 0),
        last30Days: Number(contactsActionedLast30?.count ?? 0),
      },
      syncRuns: {
        total: Number(syncRunsTotal?.count ?? 0),
        successCount: Number(syncRunsSuccess?.count ?? 0),
        failedCount: Number(syncRunsFailed?.count ?? 0),
        bySource: {
          hubspot: Number(syncRunsHubspot?.count ?? 0),
          commonroom: Number(syncRunsCommonroom?.count ?? 0),
        },
      },
      contactsBySource: {
        hubspot: Number(contactsHubspotActive?.count ?? 0),
        commonroom: Number(contactsCommonroomActive?.count ?? 0),
        prospector: Number(contactsProspectorActive?.count ?? 0),
      },
    };
  },
});
