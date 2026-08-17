import { defineAction } from "@agent-native/core";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadLists } from "../server/db/schema.js";
import { resolveOwnerStrict } from "../server/helpers/resolve-owner.js";

// Separate from list-lead-lists.ts (the dashboard's session-only version)
// because the extension has no session -- only a personal API token, same
// auth model as import-sales-nav-list.ts. Powers the "Add to Existing List"
// picker in the side panel.
export default defineAction({
  description: "List the current owner's Sales Navigator lead lists, for the extension's \"Add to Existing List\" picker.",
  schema: z.object({
    apiToken: z.string().nullish().describe("Personal API token from Settings"),
  }),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: true, requiresAuth: false },
  http: { method: "GET" },
  run: async ({ apiToken }, ctx) => {
    // Strict resolution -- this action exposes list names/ids/counts, so a
    // credential-free caller must get nothing back rather than silently
    // being treated as the workspace owner.
    const ownerEmail = await resolveOwnerStrict(apiToken, ctx);
    if (!ownerEmail) return { lists: [] };

    const db = getDb();
    const lists = await db
      .select({
        id: leadLists.id,
        name: leadLists.name,
        description: leadLists.description,
        totalCount: leadLists.totalCount,
        updatedAt: leadLists.updatedAt,
      })
      .from(leadLists)
      .where(eq(leadLists.ownerEmail, ownerEmail))
      .orderBy(desc(leadLists.updatedAt));
    return { lists };
  },
});
