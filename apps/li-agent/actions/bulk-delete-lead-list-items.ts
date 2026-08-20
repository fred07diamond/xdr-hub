import { defineAction } from "@agent-native/core";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadLists, leadListItems } from "../server/db/schema.js";

// Companion to bulk-delete-prospects.ts, for the other half of the
// Prospects table's rows -- leads still shaped as a raw leadListItems
// capture that never got promoted into a real prospects row. There was
// previously no delete path for these at all (only whole-list deletion via
// delete-lead-list.ts), which made the Prospects page's "Delete" button
// silently no-op whenever the selection was lead-list-sourced.
export default defineAction({
  description: "Permanently delete multiple lead list items (not-yet-promoted Sales Nav captures) by ID.",
  schema: z.object({ ids: z.array(z.string()).min(1) }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ ids }, ctx) => {
    const db = getDb();
    const ownerEmail = ctx?.userEmail ?? null;
    const ownerFilter = ownerEmail ? eq(leadLists.ownerEmail, ownerEmail) : isNull(leadLists.ownerEmail);

    const ownedLists = await db.select({ id: leadLists.id }).from(leadLists).where(ownerFilter);
    const ownedListIds = ownedLists.map((l) => l.id);
    if (!ownedListIds.length) return { ok: true, deleted: 0 };

    const items = await db
      .select({ id: leadListItems.id, listId: leadListItems.listId })
      .from(leadListItems)
      .where(and(inArray(leadListItems.id, ids), inArray(leadListItems.listId, ownedListIds)));
    if (!items.length) return { ok: true, deleted: 0 };

    await db.delete(leadListItems).where(inArray(leadListItems.id, items.map((i) => i.id)));

    // Keep the stored per-list totalCount (shown on the list card + summed
    // in Analytics) in sync -- get-lead-list-items.ts's own paginated view
    // already counts live, but those two surfaces trust this column.
    const countByList = new Map<string, number>();
    for (const item of items) countByList.set(item.listId, (countByList.get(item.listId) ?? 0) + 1);
    await Promise.all(
      Array.from(countByList.entries()).map(([listId, count]) =>
        db
          .update(leadLists)
          .set({ totalCount: sql`${leadLists.totalCount} - ${count}` })
          .where(eq(leadLists.id, listId)),
      ),
    );

    return { ok: true, deleted: items.length };
  },
});
