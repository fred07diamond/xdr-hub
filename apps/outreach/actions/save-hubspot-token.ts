import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { workspaceSettings } from "../server/db/schema.js";

export default defineAction({
  description: "Save the HubSpot private app access token to workspace settings.",
  schema: z.object({ token: z.string().min(1) }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ token }) => {
    const db = getDb();
    const now = new Date().toISOString();
    await db
      .insert(workspaceSettings)
      .values({ key: "hubspot_access_token", value: token, updatedAt: now })
      .onConflictDoUpdate({
        target: workspaceSettings.key,
        set: { value: token, updatedAt: now },
      });
    return { ok: true };
  },
});
