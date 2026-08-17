import { defineAction } from "@agent-native/core";
import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadLists, leadListItems } from "../server/db/schema.js";

// Paginated -- a list can hold up to IMPORT_LIMIT (500) items, and this
// used to fetch every one of them on every page load/selection change.
const DEFAULT_PAGE_SIZE = 25;

export default defineAction({
  description: "Get the leads in a Sales Navigator lead list, paginated.",
  schema: z.object({
    listId: z.string(),
    limit: z.number().int().min(1).max(500).default(DEFAULT_PAGE_SIZE),
    offset: z.number().int().min(0).default(0),
  }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ listId, limit, offset }, ctx) => {
    const db = getDb();
    const listRows = await db
      .select()
      .from(leadLists)
      .where(eq(leadLists.id, listId));
    const list = listRows[0];
    if (!list || list.ownerEmail !== ctx!.userEmail) throw new Error("List not found");

    const [[totalRow], items] = await Promise.all([
      db.select({ n: count() }).from(leadListItems).where(eq(leadListItems.listId, listId)),
      db
        .select()
        .from(leadListItems)
        .where(eq(leadListItems.listId, listId))
        .orderBy(leadListItems.position)
        .limit(limit)
        .offset(offset),
    ]);

    const totalCount = (totalRow?.n ?? 0) as number;
    return { list, items, totalCount, hasMore: offset + items.length < totalCount };
  },
});
