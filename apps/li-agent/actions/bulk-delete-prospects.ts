import { defineAction } from "@agent-native/core";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadLists, leadListItems, prospects } from "../server/db/schema.js";

export default defineAction({
  description: "Permanently delete multiple prospects by ID.",
  schema: z.object({ ids: z.array(z.string()).min(1) }),
  run: async ({ ids }, ctx) => {
    const db = getDb();
    const ownerEmail = ctx?.userEmail ?? null;
    const ownerFilter = ownerEmail ? eq(prospects.ownerEmail, ownerEmail) : isNull(prospects.ownerEmail);

    const existing = await db
      .select({ profileUrl: prospects.profileUrl })
      .from(prospects)
      .where(and(inArray(prospects.id, ids), ownerFilter));

    await db.delete(prospects).where(and(inArray(prospects.id, ids), ownerFilter));

    // Same cleanup as delete-prospect.ts -- otherwise a promoted lead-list
    // row reappears as "unvisited" once its richer prospects row is gone,
    // which is exactly what made mass delete look broken at scale.
    const profileUrls = existing.map((p) => p.profileUrl).filter((u): u is string => !!u);
    if (profileUrls.length) {
      const ownerListIds = await db
        .select({ id: leadLists.id })
        .from(leadLists)
        .where(ownerEmail ? eq(leadLists.ownerEmail, ownerEmail) : isNull(leadLists.ownerEmail));
      if (ownerListIds.length) {
        await db
          .delete(leadListItems)
          .where(
            and(
              inArray(leadListItems.profileUrl, profileUrls),
              inArray(leadListItems.listId, ownerListIds.map((l) => l.id)),
            ),
          );
      }
    }

    return { ok: true, deleted: ids.length };
  },
});
