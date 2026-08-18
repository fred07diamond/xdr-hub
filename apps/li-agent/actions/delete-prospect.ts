import { defineAction } from "@agent-native/core";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadLists, leadListItems, prospects } from "../server/db/schema.js";

export default defineAction({
  description: "Permanently delete a prospect by ID.",
  schema: z.object({ id: z.string() }),
  run: async ({ id }, ctx) => {
    const db = getDb();
    const ownerEmail = ctx?.userEmail ?? null;
    const ownerFilter = ownerEmail ? eq(prospects.ownerEmail, ownerEmail) : isNull(prospects.ownerEmail);

    const existing = await db
      .select({ profileUrl: prospects.profileUrl })
      .from(prospects)
      .where(and(eq(prospects.id, id), ownerFilter))
      .limit(1);

    await db.delete(prospects).where(and(eq(prospects.id, id), ownerFilter));

    // A prospects row promoted from a lead-list item (via score-lead-list-item.ts
    // or the normal capture flow) shares its profileUrl with the original
    // leadListItems row, which is what suppresses that shallow row from the
    // merged Prospects view (list-all-prospects.ts). Deleting only the
    // prospects row leaves that suppression-free row behind -- it reappears
    // as an "unvisited" lead, making the delete look like it didn't do
    // anything. Clean up the matching lead-list item(s) too so the person is
    // actually gone, not just downgraded back to a shallow row.
    if (existing[0]?.profileUrl) {
      const ownerListIds = await db
        .select({ id: leadLists.id })
        .from(leadLists)
        .where(ownerEmail ? eq(leadLists.ownerEmail, ownerEmail) : isNull(leadLists.ownerEmail));
      if (ownerListIds.length) {
        await db
          .delete(leadListItems)
          .where(
            and(
              eq(leadListItems.profileUrl, existing[0].profileUrl),
              inArray(leadListItems.listId, ownerListIds.map((l) => l.id)),
            ),
          );
      }
    }

    return { ok: true };
  },
});
