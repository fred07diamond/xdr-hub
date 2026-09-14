import { eq, inArray, sql } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { leadListItems, leadLists } from "../db/schema.js";

/**
 * Keeps `lead_lists.total_count` honest after items are removed.
 *
 * That column is denormalized, and it has FOUR writers -- the two bulk-delete
 * paths, single prospect delete, and import. Two of them forgot to maintain
 * it, which is how a list came to read "19 leads" while containing none: the
 * leads had been deleted from the Prospects page, which removes the underlying
 * lead_list_items rows, and nothing decremented the counter.
 *
 * Recomputes from the actual rows rather than subtracting a delta. Subtracting
 * is what drifted in the first place: it only stays correct if every caller
 * counts exactly what it deleted, and a miscount is invisible until someone
 * notices an empty list claiming 19 leads. A recount cannot drift.
 */
export async function recountLeadLists(listIds: string[]): Promise<void> {
  const ids = [...new Set(listIds.filter(Boolean))];
  if (ids.length === 0) return;
  const db = getDb();

  const rows = await db
    .select({ listId: leadListItems.listId, n: sql<number>`COUNT(*)` })
    .from(leadListItems)
    .where(inArray(leadListItems.listId, ids))
    .groupBy(leadListItems.listId);

  const counts = new Map(rows.map((r) => [r.listId, Number(r.n ?? 0)]));

  await Promise.all(
    // Lists with no remaining rows are absent from the grouped result, so they
    // must be driven from `ids` rather than from `rows` -- otherwise a list
    // emptied completely keeps its old count, which is exactly the reported
    // bug.
    ids.map((listId) =>
      db
        .update(leadLists)
        .set({ totalCount: counts.get(listId) ?? 0 })
        .where(eq(leadLists.id, listId)),
    ),
  );
}
