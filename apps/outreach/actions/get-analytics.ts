import { defineAction } from "@agent-native/core";
import { count, countDistinct, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { prospects, sendHistory } from "../server/db/schema.js";
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

    const [
      [totals],
      verdictRows,
      statusRows,
      [usersRow],
      [thisWeekRow],
      [lastWeekRow],
      [sentRow],
      byUserRows,
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

    return {
      totalProspects: (totals?.total ?? 0) as number,
      verdictCounts,
      statusCounts,
      thisWeek: (thisWeekRow?.n ?? 0) as number,
      lastWeek: (lastWeekRow?.n ?? 0) as number,
      totalUsers: (usersRow?.n ?? 0) as number,
      totalSent: (sentRow?.n ?? 0) as number,
      byUser,
    };
  },
});
