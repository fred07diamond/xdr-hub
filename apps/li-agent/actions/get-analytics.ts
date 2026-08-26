import { defineAction } from "@agent-native/core";
import { count, countDistinct, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { prospects, sendHistory, postEngagements, leadLists, leadListItems, leadCounters } from "../server/db/schema.js";

export default defineAction({
  description: "Return workspace-wide pipeline analytics. Available to every signed-in workspace member, not just admins.",
  schema: z.object({}),
  requiresAuth: true,
  http: { method: "GET" },
  readOnly: true,
  run: async (_args) => {
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
      [leadCounterTotals],
      [leadItemsThisWeekRow],
      [leadItemsLastWeekRow],
      enrichmentStatusRows,
      phoneRevealStatusRows,
      listsByUserRows,
      leadCounterByUserRows,
      // Daily trend
      prospectsTrendRows,
      engagersTrendRows,
      leadsTrendRows,
      // Persona breakdown
      prospectsPersonaRows,
      engagersPersonaRows,
      leadsPersonaRows,
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
      // Lifetime, never-decremented total -- see leadCounters' schema.ts
      // comment. Deliberately not count(leadListItems): that shrinks
      // whenever leads are deleted/cleaned up, which is exactly what made
      // this number look wrong after a mass delete.
      db.select({ total: sql<number>`coalesce(sum(${leadCounters.totalLeadsAdded}), 0)` }).from(leadCounters),
      db.select({ n: count() }).from(leadListItems).where(sql`created_at >= ${weekAgo}`),
      db.select({ n: count() }).from(leadListItems).where(sql`created_at >= ${twoWeeksAgo} AND created_at < ${weekAgo}`),
      db.select({ status: leadListItems.enrichmentStatus, n: count() }).from(leadListItems).groupBy(leadListItems.enrichmentStatus),
      db.select({ status: leadListItems.phoneRevealStatus, n: count() }).from(leadListItems).groupBy(leadListItems.phoneRevealStatus),
      db
        .select({
          ownerEmail: leadLists.ownerEmail,
          lists: count(),
        })
        .from(leadLists)
        .groupBy(leadLists.ownerEmail),
      // Per-owner lifetime leads-added, same never-decremented source as
      // leadCounterTotals above -- backs the Team Leaderboard/per-user
      // breakdown instead of sum(leadLists.totalCount).
      db.select({ ownerEmail: leadCounters.ownerEmail, leads: leadCounters.totalLeadsAdded }).from(leadCounters),
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
      // Persona breakdown -- combined across all three pipelines, since
      // persona is assigned identically (personaName/personaColor) on all
      // three tables.
      db
        .select({ name: prospects.personaName, color: prospects.personaColor, n: count() })
        .from(prospects)
        .where(sql`persona_name is not null`)
        .groupBy(prospects.personaName, prospects.personaColor),
      db
        .select({ name: postEngagements.personaName, color: postEngagements.personaColor, n: count() })
        .from(postEngagements)
        .where(sql`persona_name is not null`)
        .groupBy(postEngagements.personaName, postEngagements.personaColor),
      db
        .select({ name: leadListItems.personaName, color: leadListItems.personaColor, n: count() })
        .from(leadListItems)
        .where(sql`persona_name is not null`)
        .groupBy(leadListItems.personaName, leadListItems.personaColor),
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

    // Merge live per-owner list counts with the lifetime leads-added
    // counter -- two separate queries/tables, joined by ownerEmail here
    // since an owner can have lists with zero current leads (all deleted)
    // but a nonzero all-time total, or vice versa for a brand-new owner.
    const leadsByOwner = new Map<string | null, number>();
    for (const r of leadCounterByUserRows) leadsByOwner.set(r.ownerEmail, Number(r.leads));
    const listsByUser = listsByUserRows
      .map((r) => ({
        ownerEmail: r.ownerEmail,
        lists: Number(r.lists),
        leads: leadsByOwner.get(r.ownerEmail) ?? 0,
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

    // Merge the three pipelines' persona counts by persona name -- color
    // comes from whichever row has it (personas keep one consistent color
    // everywhere they're assigned, so any non-null value is correct).
    type PersonaAgg = { name: string; color: string | null; prospects: number; engagers: number; leads: number };
    const personaMap = new Map<string, PersonaAgg>();
    function addPersonaRows(rows: { name: string | null; color: string | null; n: number }[], key: "prospects" | "engagers" | "leads") {
      for (const r of rows) {
        if (!r.name) continue;
        const existing = personaMap.get(r.name) ?? { name: r.name, color: r.color, prospects: 0, engagers: 0, leads: 0 };
        existing.color = existing.color ?? r.color;
        existing[key] += Number(r.n);
        personaMap.set(r.name, existing);
      }
    }
    addPersonaRows(prospectsPersonaRows, "prospects");
    addPersonaRows(engagersPersonaRows, "engagers");
    addPersonaRows(leadsPersonaRows, "leads");
    const personas = [...personaMap.values()]
      .map((p) => ({ ...p, total: p.prospects + p.engagers + p.leads }))
      .sort((a, b) => b.total - a.total);

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
      personas,
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
        totalLeads: Number(leadCounterTotals?.total ?? 0),
        thisWeek: (leadItemsThisWeekRow?.n ?? 0) as number,
        lastWeek: (leadItemsLastWeekRow?.n ?? 0) as number,
        enrichmentStatusCounts,
        phoneRevealStatusCounts,
        byUser: listsByUser,
      },
    };
  },
});
