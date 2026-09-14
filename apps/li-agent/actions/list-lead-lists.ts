import { defineAction } from "@agent-native/core";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadListItems, leadLists } from "../server/db/schema.js";

export default defineAction({
  description: "List all Sales Navigator lead lists for the current user.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_input, ctx) => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) return { lists: [] };
    const db = getDb();

    // `totalCount` is COUNTED LIVE here rather than read from
    // lead_lists.total_count.
    //
    // That stored column is denormalized across four writers, and two of them
    // used to delete items without decrementing it -- which is how a list came
    // to display "19 leads" while containing none. Both writers are fixed and
    // a migration repaired the drift, but a counter that has silently gone
    // wrong once will do it again, and this is the surface where being wrong
    // is most visible and most alarming. Counting here means the sidebar
    // cannot lie regardless of what the column says.
    //
    // GROUP BY the primary key keeps the non-aggregated columns legal on
    // Postgres (functional dependency) as well as SQLite.
    const lists = await db
      .select({
        id: leadLists.id,
        ownerEmail: leadLists.ownerEmail,
        name: leadLists.name,
        description: leadLists.description,
        salesNavListUrl: leadLists.salesNavListUrl,
        createdAt: leadLists.createdAt,
        updatedAt: leadLists.updatedAt,
        totalCount: sql<number>`COUNT(${leadListItems.id})`,
        // Kept alongside so a drift is diagnosable rather than merely hidden:
        // if these two disagree, something is still writing the column wrong.
        storedCount: leadLists.totalCount,
      })
      .from(leadLists)
      // LEFT join, so an empty list still appears -- an inner join would make
      // a list with no leads vanish from the sidebar entirely, which is worse
      // than an inaccurate count.
      .leftJoin(leadListItems, eq(leadListItems.listId, leadLists.id))
      .where(eq(leadLists.ownerEmail, userEmail))
      .groupBy(leadLists.id);

    return {
      lists: lists.map((l) => ({
        ...l,
        totalCount: Number(l.totalCount ?? 0),
        storedCount: Number(l.storedCount ?? 0),
      })),
    };
  },
});
