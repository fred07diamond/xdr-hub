import { defineAction } from "@agent-native/core";
import { count, countDistinct, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { prospects, sendHistory, postEngagements, leadLists, leadListItems } from "../server/db/schema.js";
import { requireAdmin } from "../server/helpers/require-admin.js";

export default defineAction({
  description: "Return workspace-wide pipeline analytics. Admin only.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    await requireAdmin(ctx);
    const db = getDb();

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    // Daily trend window -- 14 full calendar days, used to chart activity
    // over time per pipeline. date_trunc groups in the DB's own timezone;
    // fine-grained enough for a trend chart, not meant to be billing-grade.
    const trendStart = twoWeeksAgo;

    const [
      [totals],
      verdictRows,
      statusRows,
      [usersRow],
      [thisWeekRow],
      [lastWeekRow],
      [sentRow],
      byUserRows,
      // Post Engagement (Engagement tab)
      [engagerTotals],
      [engagerDistinctPosts],
      engagerStatusRows,
      engagerVerdictRows,
      [engagerThisWeekRow],
      [engagerLastWeekRow],
      [engagerNewOppRow],
      engagerByUserRows,
      // Lead Lists
      [listTotals],
      [leadItemTotals],
      [leadItemsThisWeekRow],
      [leadItemsLastWeekRow],
      enrichmentStatusRows,
      phoneRevealStatusRows,
      listsByUserRows,
      // Daily trend
      prospectsTrendRows,
      engagersTrendRows,
      leadsTrendRows,
    ] = await Promise.all([
      db.select({ total: count() }).from(prospects),
      db.select({ verdict: prospects.fitVerdict, n: count() }).from(prospects).groupBy(prospects.fitVerdict),
      db.select({ status: prospects.status, n: count() }).from(prospects).groupBy(prospects.status),
      db.select({ n: countDistinct(prospects.ownerEmail) }).from(prospects),
      db.select({ n: count() }).from(prospects).where(sql`created_at >= ${weekAgo}`),
      db.select({ n: count() }).from(prospects).where(sql`created_at >= ${twoWeeksAgo} AND created_at < ${weekAgo}`),
      db.select({ n: count() }).from(sendHistory),
      db
        .select({
          ownerEmail: prospects.ownerEmail,
          total: count(),
          drafted: sql<number>`sum(case when ${prospects.status} = 'drafted' then 1 else 0 end)`,
          sent: sql<number>`sum(case when ${prospects.status} = 'sent' then 1 else 0 end)`,
          strong: sql<number>`sum(case when ${prospects.fitVerdict} = 'strong' then 1 else 0 end)`,
          possible: sql<number>`sum(case when ${prospects.fitVerdict} = 'possible' then 1 else 0 end)`,
          weak: sql<number>`sum(case when ${prospects.fitVerdict} = 'weak' then 1 else 0 end)`,
          inconclusive: sql<number>`sum(case when ${prospects.fitVerdict} = 'inconclusive' then 1 else 0 end)`,
        })
        .from(prospects)
        .groupBy(prospects.ownerEmail),
      db.select({ total: count() }).from(postEngagements),
      db.select({ n: countDistinct(postEngagements.postUrl) }).from(postEngagements),
      db.select({ status: postEngagements.status, n: count() }).from(postEngagements).groupBy(postEngagements.status),
      db.select({ verdict: postEngagements.fitVerdict, n: count() }).from(postEngagements).groupBy(postEngagements.fitVerdict),
      db.select({ n: count() }).from(postEngagements).where(sql`created_at >= ${weekAgo}`),
      db.select({ n: count() }).from(postEngagements).where(sql`created_at >= ${twoWeeksAgo} AND created_at < ${weekAgo}`),
      db.select({ n: count() }).from(postEngagements).where(sql`${postEngagements.hubspotStatus} = 'new_opportunity'`),
      db
        .select({
          ownerEmail: postEngagements.ownerEmail,
          total: count(),
          done: sql<number>`sum(case when ${postEngagements.status} = 'done' then 1 else 0 end)`,
          strong: sql<number>`sum(case when ${postEngagements.fitVerdict} = 'strong' then 1 else 0 end)`,
          possible: sql<number>`sum(case when ${postEngagements.fitVerdict} = 'possible' then 1 else 0 end)`,
          weak: sql<number>`sum(case when ${postEngagements.fitVerdict} = 'weak' then 1 else 0 end)`,
        })
        .from(postEngagements)
        .groupBy(postEngagements.ownerEmail),
      db.select({ total: count() }).from(leadLists),
      db.select({ total: count() }).from(leadListItems),
      db.select({ n: count() }).from(leadListItems).where(sql`created_at >= ${weekAgo}`),
      db.select({ n: count() }).from(leadListItems).where(sql`created_at >= ${twoWeeksAgo} AND created_at < ${weekAgo}`),
      db.select({ status: leadListItems.enrichmentStatus, n: count() }).from(leadListItems).groupBy(leadListItems.enrichmentStatus),
      db.select({ status: leadListItems.phoneRevealStatus, n: count() }).from(leadListItems).groupBy(leadListItems.phoneRevealStatus),
      db
        .select({
          ownerEmail: leadLists.ownerEmail,
          lists: count(),
          leads: sql<number>`sum(${leadLists.totalCount})`,
        })
        .from(leadLists)
        .groupBy(leadLists.ownerEmail),
      // Daily trend -- one grouped-by-day count per pipeline, last 14 days.
      db
        .select({ day: sql<string>`date_trunc('day', created_at::timestamptz)`, n: count() })
        .from(prospects)
        .where(sql`created_at >= ${trendStart}`)
        .groupBy(sql`date_trunc('day', created_at::timestamptz)`),
      db
        .select({ day: sql<string>`date_trunc('day', created_at::timestamptz)`, n: count() })
        .from(postEngagements)
        .where(sql`created_at >= ${trendStart}`)
        .groupBy(sql`date_trunc('day', created_at::timestamptz)`),
      db
        .select({ day: sql<string>`date_trunc('day', created_at::timestamptz)`, n: count() })
        .from(leadListItems)
        .where(sql`created_at >= ${trendStart}`)
        .groupBy(sql`date_trunc('day', created_at::timestamptz)`),
    ]);

    const verdictCounts = { strong: 0, possible: 0, weak: 0 };
    for (const r of verdictRows) {
      if (r.verdict === "strong" || r.verdict === "possible" || r.verdict === "weak") {
        verdictCounts[r.verdict] = r.n as number;
      }
    }

    const statusCounts = { captured: 0, drafted: 0, sent: 0 };
    for (const r of statusRows) {
      if (r.status === "captured" || r.status === "drafted" || r.status === "sent") {
        statusCounts[r.status] = r.n as number;
      }
    }

    const byUser = byUserRows
      .map((r) => ({
        ownerEmail: r.ownerEmail,
        total: Number(r.total),
        drafted: Number(r.drafted),
        sent: Number(r.sent),
        strong: Number(r.strong),
        possible: Number(r.possible),
        weak: Number(r.weak),
        inconclusive: Number(r.inconclusive),
      }))
      .sort((a, b) => b.total - a.total);

    const engagerStatusCounts = { pending: 0, enriching: 0, scoring: 0, done: 0 };
    for (const r of engagerStatusRows) {
      if (r.status && r.status in engagerStatusCounts) {
        engagerStatusCounts[r.status as keyof typeof engagerStatusCounts] = r.n as number;
      }
    }

    const engagerVerdictCounts = { strong: 0, possible: 0, weak: 0 };
    for (const r of engagerVerdictRows) {
      if (r.verdict === "strong" || r.verdict === "possible" || r.verdict === "weak") {
        engagerVerdictCounts[r.verdict] = r.n as number;
      }
    }

    const engagerByUser = engagerByUserRows
      .map((r) => ({
        ownerEmail: r.ownerEmail,
        total: Number(r.total),
        done: Number(r.done),
        strong: Number(r.strong),
        possible: Number(r.possible),
        weak: Number(r.weak),
      }))
      .sort((a, b) => b.total - a.total);

    const enrichmentStatusCounts = { idle: 0, enriching: 0, done: 0, not_found: 0, failed: 0 };
    for (const r of enrichmentStatusRows) {
      if (r.status && r.status in enrichmentStatusCounts) {
        enrichmentStatusCounts[r.status as keyof typeof enrichmentStatusCounts] = r.n as number;
      }
    }

    const phoneRevealStatusCounts = { requested: 0, done: 0, no_match: 0, failed: 0 };
    for (const r of phoneRevealStatusRows) {
      if (r.status && r.status in phoneRevealStatusCounts) {
        phoneRevealStatusCounts[r.status as keyof typeof phoneRevealStatusCounts] = r.n as number;
      }
    }

    const listsByUser = listsByUserRows
      .map((r) => ({
        ownerEmail: r.ownerEmail,
        lists: Number(r.lists),
        leads: Number(r.leads),
      }))
      .sort((a, b) => b.leads - a.leads);

    // Merge the three per-pipeline daily counts into one dense 14-day
    // series (today inclusive), filling zero for days with no activity --
    // a chart needs every day present, not just the days that had rows.
    function dayKey(d: Date) {
      return d.toISOString().slice(0, 10);
    }
    function toDailyMap(rows: { day: string; n: number }[]) {
      const m = new Map<string, number>();
      for (const r of rows) m.set(new Date(r.day).toISOString().slice(0, 10), Number(r.n));
      return m;
    }
    const prospectsByDay = toDailyMap(prospectsTrendRows);
    const engagersByDay = toDailyMap(engagersTrendRows);
    const leadsByDay = toDailyMap(leadsTrendRows);

    const trend: { date: string; label: string; prospects: number; engagers: number; leads: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = dayKey(d);
      trend.push({
        date: key,
        label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        prospects: prospectsByDay.get(key) ?? 0,
        engagers: engagersByDay.get(key) ?? 0,
        leads: leadsByDay.get(key) ?? 0,
      });
    }

    return {
      totalProspects: (totals?.total ?? 0) as number,
      verdictCounts,
      statusCounts,
      thisWeek: (thisWeekRow?.n ?? 0) as number,
      lastWeek: (lastWeekRow?.n ?? 0) as number,
      totalUsers: (usersRow?.n ?? 0) as number,
      totalSent: (sentRow?.n ?? 0) as number,
      byUser,
      trend,
      postEngagement: {
        totalEngagers: (engagerTotals?.total ?? 0) as number,
        distinctPosts: (engagerDistinctPosts?.n ?? 0) as number,
        statusCounts: engagerStatusCounts,
        verdictCounts: engagerVerdictCounts,
        thisWeek: (engagerThisWeekRow?.n ?? 0) as number,
        lastWeek: (engagerLastWeekRow?.n ?? 0) as number,
        newOpportunities: (engagerNewOppRow?.n ?? 0) as number,
        byUser: engagerByUser,
      },
      leadLists: {
        totalLists: (listTotals?.total ?? 0) as number,
        totalLeads: (leadItemTotals?.total ?? 0) as number,
        thisWeek: (leadItemsThisWeekRow?.n ?? 0) as number,
        lastWeek: (leadItemsLastWeekRow?.n ?? 0) as number,
        enrichmentStatusCounts,
        phoneRevealStatusCounts,
        byUser: listsByUser,
      },
    };
  },
});
