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

    const [totals] = await db
      .select({ total: count() })
      .from(prospects);

    const verdictRows = await db
      .select({
        verdict: prospects.fitVerdict,
        n: count(),
      })
      .from(prospects)
      .groupBy(prospects.fitVerdict);

    const statusRows = await db
      .select({
        status: prospects.status,
        n: count(),
      })
      .from(prospects)
      .groupBy(prospects.status);

    const [usersRow] = await db
      .select({ n: countDistinct(prospects.ownerEmail) })
      .from(prospects);

    const [thisWeekRow] = await db
      .select({ n: count() })
      .from(prospects)
      .where(sql`created_at >= ${weekAgo}`);

    const [lastWeekRow] = await db
      .select({ n: count() })
      .from(prospects)
      .where(sql`created_at >= ${twoWeeksAgo} AND created_at < ${weekAgo}`);

    const [sentRow] = await db
      .select({ n: count() })
      .from(sendHistory);

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

    return {
      totalProspects: (totals?.total ?? 0) as number,
      verdictCounts,
      statusCounts,
      thisWeek: (thisWeekRow?.n ?? 0) as number,
      lastWeek: (lastWeekRow?.n ?? 0) as number,
      totalUsers: (usersRow?.n ?? 0) as number,
      totalSent: (sentRow?.n ?? 0) as number,
    };
  },
});
