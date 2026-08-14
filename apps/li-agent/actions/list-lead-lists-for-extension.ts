import { defineAction } from "@agent-native/core";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadLists } from "../server/db/schema.js";
import { resolveOwner } from "../server/helpers/resolve-owner.js";

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
    const ownerEmail = await resolveOwner(apiToken, ctx);
    const db = getDb();
    const ownerFilter = ownerEmail ? eq(leadLists.ownerEmail, ownerEmail) : isNull(leadLists.ownerEmail);
    const lists = await db
      .select({ id: leadLists.id, name: leadLists.name, totalCount: leadLists.totalCount })
      .from(leadLists)
      .where(and(ownerFilter))
      .orderBy(desc(leadLists.updatedAt));
    return { lists };
  },
});
