import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { workspaceSettings } from "../server/db/schema.js";
import { requireAdmin } from "../server/helpers/require-admin.js";

export default defineAction({
  description: "Set the workspace-wide daily outreach limit. Admin only.",
  schema: z.object({
    limit: z.number().int().min(1).max(500),
  }),
  requiresAuth: true,
  run: async ({ limit }, ctx) => {
    await requireAdmin(ctx);
    const db = getDb();
    const now = new Date().toISOString();

    await db
      .insert(workspaceSettings)
      .values({
        key: "daily_outreach_limit",
        value: String(limit),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: workspaceSettings.key,
        set: { value: String(limit), updatedAt: now },
      });

    return { ok: true, limit };
  },
});
