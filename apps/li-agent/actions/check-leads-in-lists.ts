import { defineAction } from "@agent-native/core";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { leadListItems, leadLists } from "../server/db/schema.js";
import { resolveOwnerStrict } from "../server/helpers/resolve-owner.js";

/**
 * Which of these Sales Nav leads are ALREADY in a lead list that still exists.
 *
 * The extension used to answer this from `chrome.storage.local`
 * (`bliAlreadySentLeadUrls`), written when a capture was sent and never
 * reconciled with the server. Two consequences, both reported as bugs:
 *
 * 1. **Deleting a list did not free its leads.** The local cache still claimed
 *    they were in "9/1 pull", so on the next capture they were auto-excluded
 *    and could not be re-imported -- the list they supposedly belonged to no
 *    longer existed. That is what "16 leads captured (5 selected)" was.
 * 2. **The cache was per-browser.** A lead imported on another machine, or
 *    before a reinstall, showed as brand new.
 *
 * The server is the only thing that knows the truth, so it answers now.
 *
 * The INNER JOIN onto `lead_lists` is the actual fix, and it is deliberately
 * belt-and-braces: `delete-lead-list` already cascades to its items, so an
 * orphaned item should not exist -- but joining means that even if some future
 * path drops a list without its items, an orphan can never make a lead look
 * un-importable. A lead counts as "in a list" only when the list is really
 * there.
 */
export default defineAction({
  description:
    "Given Sales Navigator lead URLs, report which are already in one of this user's existing lead lists (and which list), so the extension can exclude true duplicates without blocking leads whose list has since been deleted.",
  schema: z.object({
    salesNavLeadUrls: z
      .array(z.string().min(1))
      // A Sales Nav capture is paged by hand; a few hundred is a big session.
      // Capped so one call cannot build an unbounded IN clause.
      .max(2000)
      .describe("Sales Navigator lead URLs from the current capture"),
    apiToken: z.string().nullish().describe("Personal API token from Settings"),
  }),
  publicAgent: { expose: true, readOnly: true, requiresAuth: false },
  readOnly: true,
  http: { method: "POST" },
  run: async ({ salesNavLeadUrls, apiToken }, ctx) => {
    const ownerEmail = await resolveOwnerStrict(apiToken, ctx);

    const urls = [...new Set(salesNavLeadUrls.filter(Boolean))];
    if (urls.length === 0) return { inLists: {} as Record<string, never>, checked: 0 };

    // Ownership lives on lead_lists, not on the items -- matching
    // import-sales-nav-list.ts's own dedupe filter, so the two answers about
    // "is this a duplicate" cannot disagree about whose data they mean.
    // resolveOwnerStrict can return null (no session and no token), and that
    // must scope to the null-owner rows rather than matching everyone.
    const ownerFilter = ownerEmail
      ? eq(leadLists.ownerEmail, ownerEmail)
      : isNull(leadLists.ownerEmail);

    const rows = await getDb()
      .select({
        salesNavLeadUrl: leadListItems.salesNavLeadUrl,
        listId: leadLists.id,
        listName: leadLists.name,
        addedAt: leadListItems.createdAt,
      })
      .from(leadListItems)
      // Inner join: an item whose list is gone does not count.
      .innerJoin(leadLists, eq(leadListItems.listId, leadLists.id))
      .where(and(ownerFilter, inArray(leadListItems.salesNavLeadUrl, urls)));

    const inLists: Record<string, { listId: string; listName: string; addedAt: string | null }> = {};
    for (const r of rows) {
      if (!r.salesNavLeadUrl) continue;
      // First hit wins. A lead can legitimately sit in several lists; the chip
      // only has room to name one, and which one is not worth a second query.
      if (inLists[r.salesNavLeadUrl]) continue;
      inLists[r.salesNavLeadUrl] = {
        listId: r.listId,
        listName: r.listName ?? "a list",
        addedAt: r.addedAt ?? null,
      };
    }

    return {
      inLists,
      // The extension needs to distinguish "checked, and these are clean" from
      // "the check never ran" -- only the first justifies clearing a local
      // exclusion.
      checked: urls.length,
    };
  },
});
