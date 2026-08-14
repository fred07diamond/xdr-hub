import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { workspaceSettings } from "../server/db/schema.js";

// TEMPORARY -- lets me see the raw Apollo phone-reveal webhook payload
// without needing server log access, so apollo-phone-reveal-webhook.ts's
// best-guess field parsing can be corrected from real data. Visit this
// action's URL directly in a logged-in browser tab to read it. Remove once
// the reveal flow is confirmed working end to end.
export default defineAction({
  description: "Returns the most recent raw Apollo phone-reveal webhook payload captured for debugging.",
  schema: z.object({}),
  requiresAuth: true,
  http: { method: "GET" },
  run: async () => {
    const db = getDb();
    const rows = await db
      .select()
      .from(workspaceSettings)
      .where(eq(workspaceSettings.key, "debug_last_apollo_webhook_payload"))
      .limit(1);
    return { payload: rows[0]?.value ?? null, updatedAt: rows[0]?.updatedAt ?? null };
  },
});
