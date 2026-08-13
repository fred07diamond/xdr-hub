import { defineAction } from "@agent-native/core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadLists, leadListItems } from "../server/db/schema.js";
import { resolveOwner } from "../server/helpers/resolve-owner.js";
import { checkRateLimit } from "../server/helpers/rate-limit.js";

// Sales Nav lists can run into the thousands -- cap like import-hubspot-
// queue.ts's IMPORT_LIMIT so one import can't produce an unbounded insert.
const IMPORT_LIMIT = 500;

export default defineAction({
  description:
    "Import a Sales Navigator saved lead list captured by the Builder.LI extension. Shallow import only -- no ICP scoring or draft note generation happens here; that still happens later, per-lead, through the existing capture-profile flow when the xDR opens that lead's profile page.",
  schema: z.object({
    listName: z.string().describe("Name of the Sales Navigator list, or a derived/fallback name"),
    listUrl: z.string().url().nullish().describe("URL of the Sales Navigator list page"),
    leads: z
      .array(
        z.object({
          name: z.string().nullish(),
          headline: z.string().nullish(),
          company: z.string().nullish(),
          location: z.string().nullish(),
          salesNavLeadUrl: z.string().url().nullish(),
        }),
      )
      .min(1)
      .describe("Leads accumulated across all pages of the list, deduped by salesNavLeadUrl"),
    apiToken: z.string().nullish().describe("Personal API token from Settings"),
  }),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: false, requiresAuth: false },
  run: async ({ listName, listUrl, leads, apiToken }, ctx) => {
    const ownerEmail = await resolveOwner(apiToken, ctx);

    if (!(await checkRateLimit(ownerEmail ?? "anonymous", "import-sales-nav-list", 20))) {
      return { listId: "", totalCount: 0, error: "Rate limit reached -- try again shortly." };
    }

    const capped = leads.slice(0, IMPORT_LIMIT);
    const truncated = leads.length > IMPORT_LIMIT;

    const db = getDb();
    const listId = nanoid();
    const now = new Date().toISOString();

    // Always creates a new list entity, even re-importing the same listUrl --
    // matches import-hubspot-queue.ts's real behavior (no upsert/merge by
    // list id there either).
    await db.insert(leadLists).values({
      id: listId,
      ownerEmail,
      name: listName,
      salesNavListUrl: listUrl ?? null,
      totalCount: capped.length,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(leadListItems).values(
      capped.map((lead, i) => ({
        id: nanoid(),
        listId,
        name: lead.name ?? null,
        headline: lead.headline ?? null,
        company: lead.company ?? null,
        location: lead.location ?? null,
        profileUrl: null,
        salesNavLeadUrl: lead.salesNavLeadUrl ?? null,
        status: "pending" as const,
        position: i,
        createdAt: now,
        updatedAt: now,
      })),
    );

    return { listId, totalCount: capped.length, truncated };
  },
});
