import { defineAction } from "@agent-native/core";
import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { prospects, workspaceSettings } from "../server/db/schema.js";
import { resolveOwner } from "../server/helpers/resolve-owner.js";

export default defineAction({
  description: "Return how many profiles the current user captured today and the workspace daily limit.",
  schema: z.object({
    apiToken: z.string().nullish().describe("Personal API token"),
  }),
  http: { method: "GET" },
  readOnly: true,
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: true, requiresAuth: false },
  run: async ({ apiToken }, ctx) => {
    const db = getDb();
    const ownerEmail = await resolveOwner(apiToken, ctx);

    const todayIso = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

    let capturedToday = 0;
    if (ownerEmail) {
      const rows = await db
        .select({ id: prospects.id })
        .from(prospects)
        .where(
          and(
            eq(prospects.ownerEmail, ownerEmail),
            gte(prospects.createdAt, todayIso),
          ),
        );
      capturedToday = rows.length;
    }

    const limitRow = await db
      .select({ value: workspaceSettings.value })
      .from(workspaceSettings)
      .where(eq(workspaceSettings.key, "daily_outreach_limit"))
      .limit(1);

    const limit = limitRow[0]?.value ? parseInt(limitRow[0].value, 10) : null;

    return { ok: true, capturedToday, limit };
  },
});
