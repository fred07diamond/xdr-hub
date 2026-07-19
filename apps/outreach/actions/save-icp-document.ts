import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icpSources } from "../server/db/schema.js";
import { requireAdmin } from "../server/helpers/require-admin.js";

export default defineAction({
  description:
    "Save the user's ICP (Ideal Customer Profile) document. Call this when the user shares or uploads their ICP document — paste the full extracted text as the `text` argument. The document is stored and used to score fit and draft connection notes for every captured LinkedIn profile.",
  schema: z.object({
    text: z.string().min(1).describe("Full text content of the ICP document"),
  }),
  run: async ({ text }, ctx) => {
    await requireAdmin(ctx);
    const db = getDb();
    const now = new Date().toISOString();

    await db
      .insert(icpSources)
      .values({ id: "singleton", sources: "[]", icpText: text, updatedAt: now })
      .onConflictDoUpdate({
        target: icpSources.id,
        set: { icpText: text, updatedAt: now },
      });

    const wordCount = text.split(/\s+/).filter(Boolean).length;
    return { ok: true, wordCount };
  },
});
