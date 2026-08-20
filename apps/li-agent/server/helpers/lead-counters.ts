import { eq, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../db/index.js";
import { leadCounters } from "../db/schema.js";

// Call once per batch of newly-inserted leadListItems rows, never on
// deletion -- this backs Analytics' all-time "Leads" metric (see schema.ts
// comment on leadCounters), which must not shrink when leads are later
// cleaned up or deleted.
export async function incrementLeadCounter(ownerEmail: string | null, count: number): Promise<void> {
  if (count <= 0) return;
  const db = getDb();
  const ownerFilter = ownerEmail ? eq(leadCounters.ownerEmail, ownerEmail) : isNull(leadCounters.ownerEmail);
  const [existing] = await db.select({ id: leadCounters.id }).from(leadCounters).where(ownerFilter);
  const now = new Date().toISOString();
  if (existing) {
    await db
      .update(leadCounters)
      .set({ totalLeadsAdded: sql`${leadCounters.totalLeadsAdded} + ${count}`, updatedAt: now })
      .where(eq(leadCounters.id, existing.id));
  } else {
    await db.insert(leadCounters).values({ id: nanoid(), ownerEmail, totalLeadsAdded: count, createdAt: now, updatedAt: now });
  }
}
