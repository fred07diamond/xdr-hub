import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { rateLimitCounters } from "../db/schema.js";

const WINDOW_MS = 60 * 60 * 1000; // 1 hour, fixed window

/**
 * Simple fixed-window rate limit, scoped to a caller-supplied bucket
 * (typically the resolved owner email) and an action name. Returns true if
 * the call is allowed, false if the bucket is over its limit for the
 * current window.
 *
 * Intentionally coarse — this exists to put a hard ceiling on the small set
 * of public, paid-work-triggering endpoints, not to be a general-purpose
 * rate limiter for the whole workspace.
 */
export async function checkRateLimit(
  bucket: string,
  action: string,
  limit: number,
): Promise<boolean> {
  const db = getDb();
  const id = `${bucket}|${action}`;
  const now = Date.now();

  const rows = await db
    .select()
    .from(rateLimitCounters)
    .where(eq(rateLimitCounters.id, id))
    .limit(1);
  const row = rows[0];

  const windowExpired = !row || now - new Date(row.windowStart).getTime() > WINDOW_MS;
  if (windowExpired) {
    const windowStart = new Date(now).toISOString();
    await db
      .insert(rateLimitCounters)
      .values({ id, count: 1, windowStart })
      .onConflictDoUpdate({ target: rateLimitCounters.id, set: { count: 1, windowStart } });
    return true;
  }

  if (row.count >= limit) return false;

  await db
    .update(rateLimitCounters)
    .set({ count: row.count + 1 })
    .where(eq(rateLimitCounters.id, id));
  return true;
}
