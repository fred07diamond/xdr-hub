import { defineAction } from "@agent-native/core";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadLists, leadListItems } from "../server/db/schema.js";
import { resolveOwner } from "../server/helpers/resolve-owner.js";
import { checkRateLimit } from "../server/helpers/rate-limit.js";

const MAX_URLS = 200;

// Powers the extension's "already in your list" chip on a Sales Nav list/
// search page -- given the salesNavLeadUrls visible on the current page,
// tells the content script which ones this owner has already captured
// into ANY lead list. Same cross-list identity key (salesNavLeadUrl,
// scoped to the owner's own lists) that import-sales-nav-list.ts's own
// dedupe already uses, so "already in your list" here means exactly what
// re-importing that lead would have skipped as a duplicate.
export default defineAction({
  description: "Given a batch of Sales Navigator lead URLs, return which ones the current owner has already captured into a lead list.",
  schema: z.object({
    salesNavLeadUrls: z.array(z.string()).min(1).max(MAX_URLS),
    apiToken: z.string().nullish().describe("Personal API token from Settings"),
  }),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: true, requiresAuth: false },
  http: { method: "POST" },
  run: async ({ salesNavLeadUrls, apiToken }, ctx) => {
    const ownerEmail = await resolveOwner(apiToken, ctx);

    if (!(await checkRateLimit(ownerEmail ?? "anonymous", "check-sales-nav-leads-captured", 120))) {
      return { capturedUrls: [], error: "Rate limit reached -- try again shortly." };
    }

    const db = getDb();
    const ownerFilter = ownerEmail ? eq(leadLists.ownerEmail, ownerEmail) : isNull(leadLists.ownerEmail);
    const ownedLists = await db.select({ id: leadLists.id }).from(leadLists).where(ownerFilter);
    const ownedListIds = ownedLists.map((l) => l.id);
    if (!ownedListIds.length) return { capturedUrls: [] };

    const rows = await db
      .select({ salesNavLeadUrl: leadListItems.salesNavLeadUrl })
      .from(leadListItems)
      .where(and(inArray(leadListItems.salesNavLeadUrl, salesNavLeadUrls), inArray(leadListItems.listId, ownedListIds)));

    const capturedUrls = [...new Set(rows.map((r) => r.salesNavLeadUrl).filter((u): u is string => !!u))];
    return { capturedUrls };
  },
});
