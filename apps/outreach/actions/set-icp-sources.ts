import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icpSources } from "../server/db/schema.js";
import { requireAdmin } from "../server/helpers/require-admin.js";

export default defineAction({
  description:
    "Save the selected Notion page IDs and titles as the active ICP sources. These will be fetched live and used to score and draft every subsequent captured profile.",
  schema: z.object({
    sources: z
      .array(
        z.object({
          id: z.string().describe("Notion page ID"),
          title: z.string().describe("Page title for display"),
        }),
      )
      .describe("The pages to use as ICP context"),
  }),
  run: async ({ sources }, ctx) => {
    await requireAdmin(ctx);
    const db = getDb();
    const now = new Date().toISOString();

    await db
      .insert(icpSources)
      .values({
        id: "singleton",
        sources: JSON.stringify(sources),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: icpSources.id,
        set: { sources: JSON.stringify(sources), updatedAt: now },
      });

    return { ok: true, count: sources.length };
  },
});
