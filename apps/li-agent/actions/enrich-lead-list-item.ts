import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadLists, leadListItems } from "../server/db/schema.js";
import { enrichLeadListItem } from "../server/helpers/enrich-lead-list-item.js";
import { checkRateLimit } from "../server/helpers/rate-limit.js";

export default defineAction({
  description:
    "Enrich a single Sales Navigator lead list item with Apollo.io person + company data (email, title, LinkedIn URL, company industry/size). Dashboard-only, on-demand — never runs automatically at import time.",
  schema: z.object({
    itemId: z.string(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ itemId }, ctx) => {
    const db = getDb();

    // Verify the item exists and belongs to the requesting user's list.
    const itemRows = await db.select().from(leadListItems).where(eq(leadListItems.id, itemId));
    const item = itemRows[0];
    if (!item) throw new Error("Item not found");
    const listRows = await db.select().from(leadLists).where(eq(leadLists.id, item.listId));
    if (!listRows[0] || listRows[0].ownerEmail !== ctx!.userEmail) throw new Error("Not authorized");

    // Raised from 100/hr -- real xDR usage runs ~500 leads/day, often
    // enriched in one sitting right after a big import ("Enrich all" on a
    // list), so a single-user hourly cap needs real headroom above that.
    if (!(await checkRateLimit(ctx!.userEmail!, "enrich-lead-list-item", 1000))) {
      return { ok: false, error: "Rate limit reached — try again shortly." };
    }

    if (!item.name) {
      return { ok: false, error: "Lead has no name to match against Apollo." };
    }

    const now = new Date().toISOString();
    await db.update(leadListItems).set({ enrichmentStatus: "enriching", updatedAt: now }).where(eq(leadListItems.id, itemId));

    const result = await enrichLeadListItem(db, item);

    return { ok: true, ...result };
  },
});
