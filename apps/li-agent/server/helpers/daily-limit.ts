import { and, count, eq, gte } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { prospects, workspaceSettings } from "../db/schema.js";

/**
 * Returns true if the given owner has already hit (or passed) the
 * workspace's configured daily outreach cap. Returns false — never blocks —
 * when no admin has configured a limit yet, matching get-daily-stats.ts's
 * existing display logic exactly.
 */
export async function isOverDailyLimit(ownerEmail: string | null): Promise<boolean> {
  if (!ownerEmail) return false;
  const db = getDb();

  const limitRow = await db
    .select({ value: workspaceSettings.value })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.key, "daily_outreach_limit"))
    .limit(1);
  const limit = limitRow[0]?.value ? parseInt(limitRow[0].value, 10) : null;
  if (limit === null || Number.isNaN(limit)) return false;

  const todayIso = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  const [row] = await db
    .select({ n: count() })
    .from(prospects)
    .where(and(eq(prospects.ownerEmail, ownerEmail), gte(prospects.createdAt, todayIso)));
  const capturedToday = (row?.n ?? 0) as number;

  return capturedToday >= limit;
}
