import { defineAction } from "@agent-native/core";
import { and, eq, inArray, sql } from "@agent-native/core/db/schema";
import { getSharedDb, sharedPersonas } from "@xdr-hub/shared/server";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { analyticsEvents, contacts, syncRecords } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

// Trend window -- 14 full calendar days, dense-filled so a chart always has
// every day present rather than only the days that had activity.
const TREND_DAYS = 14;

// Bucketed in JS rather than a SQL date_trunc/strftime, which are NOT
// portable between this app's SQLite (local dev) and Postgres (production)
// backends -- see the portability skill. A 14-day window of contact rows is
// small enough that fetching raw timestamps and grouping here costs nothing
// real.
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default defineAction({
  description:
    "Return workspace-wide analytics: contact volume and score distribution, persona composition, a 14-day per-source activity trend, sync run health, and a per-teammate activity leaderboard.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_input, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    const now = new Date();
    const weekAgoIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoWeeksAgoIso = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgoIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const trendStartIso = new Date(now.getTime() - (TREND_DAYS - 1) * 24 * 60 * 60 * 1000).toISOString();

    const [
      [totalContacts],
      [activeContacts],
      [scoreBuckets],
      bySourceRows,
      personaRows,
      trendRows,
      [segmentsCreatedTotal],
      [segmentsCreatedLast30],
      [contactsActionedTotal],
      [contactsActionedLast30],
      [contactsActionedThisWeek],
      [contactsActionedLastWeek],
      [syncRunsTotal],
      [syncRunsSuccess],
      [syncRunsFailed],
      syncRunsBySourceRows,
      byUserRows,
    ] = await Promise.all([
      db.select({ n: sql<number>`count(*)` }).from(contacts),
      db.select({ n: sql<number>`count(*)` }).from(contacts).where(eq(contacts.status, "active")),
      // One row, four aggregates -- CASE WHEN is identical SQL on both
      // SQLite and Postgres, unlike a date/string function.
      db
        .select({
          excellent: sql<number>`sum(case when ${contacts.overallScore} >= 80 then 1 else 0 end)`,
          good: sql<number>`sum(case when ${contacts.overallScore} >= 50 and ${contacts.overallScore} < 80 then 1 else 0 end)`,
          weak: sql<number>`sum(case when ${contacts.overallScore} < 50 then 1 else 0 end)`,
          unscored: sql<number>`sum(case when ${contacts.overallScore} is null then 1 else 0 end)`,
        })
        .from(contacts)
        .where(eq(contacts.status, "active")),
      db
        .select({ source: contacts.source, n: sql<number>`count(*)` })
        .from(contacts)
        .where(eq(contacts.status, "active"))
        .groupBy(contacts.source),
      db
        .select({ personaId: contacts.personaId, n: sql<number>`count(*)` })
        .from(contacts)
        .where(and(eq(contacts.status, "active"), sql`${contacts.personaId} is not null`))
        .groupBy(contacts.personaId),
      db
        .select({ syncedAt: contacts.syncedAt, source: contacts.source })
        .from(contacts)
        .where(sql`${contacts.syncedAt} >= ${trendStartIso}`),
      db
        .select({ count: sql<number>`count(*)` })
        .from(analyticsEvents)
        .where(eq(analyticsEvents.eventType, "segment_created")),
      db
        .select({ count: sql<number>`count(*)` })
        .from(analyticsEvents)
        .where(
          and(eq(analyticsEvents.eventType, "segment_created"), sql`${analyticsEvents.timestamp} >= ${thirtyDaysAgoIso}`),
        ),
      db
        .select({ count: sql<number>`count(*)` })
        .from(analyticsEvents)
        .where(eq(analyticsEvents.eventType, "contact_actioned")),
      db
        .select({ count: sql<number>`count(*)` })
        .from(analyticsEvents)
        .where(
          and(eq(analyticsEvents.eventType, "contact_actioned"), sql`${analyticsEvents.timestamp} >= ${thirtyDaysAgoIso}`),
        ),
      db
        .select({ count: sql<number>`count(*)` })
        .from(analyticsEvents)
        .where(and(eq(analyticsEvents.eventType, "contact_actioned"), sql`${analyticsEvents.timestamp} >= ${weekAgoIso}`)),
      db
        .select({ count: sql<number>`count(*)` })
        .from(analyticsEvents)
        .where(
          and(
            eq(analyticsEvents.eventType, "contact_actioned"),
            sql`${analyticsEvents.timestamp} >= ${twoWeeksAgoIso} AND ${analyticsEvents.timestamp} < ${weekAgoIso}`,
          ),
        ),
      db.select({ count: sql<number>`count(*)` }).from(syncRecords),
      db.select({ count: sql<number>`count(*)` }).from(syncRecords).where(eq(syncRecords.status, "success")),
      db.select({ count: sql<number>`count(*)` }).from(syncRecords).where(eq(syncRecords.status, "failed")),
      db.select({ source: syncRecords.source, n: sql<number>`count(*)` }).from(syncRecords).groupBy(syncRecords.source),
      db
        .select({
          userEmail: analyticsEvents.userEmail,
          segmentsCreated: sql<number>`sum(case when ${analyticsEvents.eventType} = 'segment_created' then 1 else 0 end)`,
          contactsActioned: sql<number>`sum(case when ${analyticsEvents.eventType} = 'contact_actioned' then 1 else 0 end)`,
          syncRuns: sql<number>`sum(case when ${analyticsEvents.eventType} = 'sync_run' then 1 else 0 end)`,
        })
        .from(analyticsEvents)
        .groupBy(analyticsEvents.userEmail),
    ]);

    const bySource = { hubspot: 0, commonroom: 0, prospector: 0 };
    for (const r of bySourceRows) {
      if (r.source === "hubspot" || r.source === "commonroom" || r.source === "prospector") {
        bySource[r.source] = Number(r.n);
      }
    }

    const syncRunsBySource = { hubspot: 0, commonroom: 0, prospector: 0 };
    for (const r of syncRunsBySourceRows) {
      if (r.source === "hubspot" || r.source === "commonroom" || r.source === "prospector") {
        syncRunsBySource[r.source] = Number(r.n);
      }
    }

    // Actual persona composition today -- the same DonutBreakdown this
    // renders with is the surface a future "target vs. actual" composition
    // gauge (the scheduled multi-source pull) would extend, once a
    // composition-rule concept with a target mix actually exists. Personas
    // live in the shared cross-app DB now -- separate query + Map merge for
    // name/color, same idiom as list-personas.ts's own counts.
    const activePersonaIds = personaRows.map((r) => r.personaId).filter((id): id is string => !!id);
    const personaDisplayRows = activePersonaIds.length
      ? await getSharedDb()
          .select({ id: sharedPersonas.id, name: sharedPersonas.name, color: sharedPersonas.color })
          .from(sharedPersonas)
          .where(inArray(sharedPersonas.id, activePersonaIds))
      : [];
    const personaDisplayById = new Map(personaDisplayRows.map((p) => [p.id, p]));

    const personaBreakdown = personaRows
      .filter((r): r is typeof r & { personaId: string } => !!r.personaId && personaDisplayById.has(r.personaId))
      .map((r) => {
        const p = personaDisplayById.get(r.personaId)!;
        return { id: r.personaId, name: p.name, color: p.color, total: Number(r.n) };
      })
      .sort((a, b) => b.total - a.total);

    // Dense-fill each of the last TREND_DAYS days, per source -- a chart
    // needs every day present, not just the days that had a sync.
    const byDay = new Map<string, { hubspot: number; commonroom: number; prospector: number }>();
    for (const r of trendRows) {
      if (!r.syncedAt) continue;
      const key = dayKey(new Date(r.syncedAt));
      const entry = byDay.get(key) ?? { hubspot: 0, commonroom: 0, prospector: 0 };
      if (r.source === "hubspot" || r.source === "commonroom" || r.source === "prospector") entry[r.source] += 1;
      byDay.set(key, entry);
    }
    const trend: { date: string; label: string; hubspot: number; commonroom: number; prospector: number }[] = [];
    for (let i = TREND_DAYS - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = dayKey(d);
      const entry = byDay.get(key) ?? { hubspot: 0, commonroom: 0, prospector: 0 };
      trend.push({ date: key, label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), ...entry });
    }

    const byUser = byUserRows
      .map((r) => ({
        userEmail: r.userEmail,
        segmentsCreated: Number(r.segmentsCreated),
        contactsActioned: Number(r.contactsActioned),
        syncRuns: Number(r.syncRuns),
        total: Number(r.segmentsCreated) + Number(r.contactsActioned) + Number(r.syncRuns),
      }))
      .sort((a, b) => b.total - a.total);

    return {
      totalContacts: Number(totalContacts?.n ?? 0),
      activeContacts: Number(activeContacts?.n ?? 0),
      scoreBuckets: {
        excellent: Number(scoreBuckets?.excellent ?? 0),
        good: Number(scoreBuckets?.good ?? 0),
        weak: Number(scoreBuckets?.weak ?? 0),
        unscored: Number(scoreBuckets?.unscored ?? 0),
      },
      bySource,
      personas: personaBreakdown,
      trend,
      thisWeek: Number(contactsActionedThisWeek?.count ?? 0),
      lastWeek: Number(contactsActionedLastWeek?.count ?? 0),
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
        bySource: syncRunsBySource,
      },
      byUser,
    };
  },
});
