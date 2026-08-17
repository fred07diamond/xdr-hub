import { defineAction } from "@agent-native/core";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadLists, leadListItems } from "../server/db/schema.js";
import { resolveOwnerStrict } from "../server/helpers/resolve-owner.js";

// Extension-facing counterpart to get-lead-list-items.ts (dashboard,
// session-only) -- same auth model as list-lead-lists-for-extension.ts.
// Powers the "Export to Apollo" CSV builder in the side panel, which needs
// the full item rows (not just id/name/totalCount) to build the file.
export default defineAction({
  description: "Get the leads in a Sales Navigator lead list, for the extension's Apollo CSV export.",
  schema: z.object({
    listId: z.string(),
    apiToken: z.string().nullish().describe("Personal API token from Settings"),
  }),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: true, requiresAuth: false },
  http: { method: "GET" },
  run: async ({ listId, apiToken }, ctx) => {
    const ownerEmail = await resolveOwnerStrict(apiToken, ctx);
    if (!ownerEmail) return { list: null, items: [] };

    const db = getDb();
    const [list] = await db
      .select()
      .from(leadLists)
      .where(and(eq(leadLists.id, listId), eq(leadLists.ownerEmail, ownerEmail)));
    if (!list) return { list: null, items: [] };

    const items = await db
      .select()
      .from(leadListItems)
      .where(eq(leadListItems.listId, listId))
      .orderBy(leadListItems.position);
    return { list, items };
  },
});
