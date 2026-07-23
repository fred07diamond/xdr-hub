import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { hubspotQueueItems } from "../server/db/schema.js";

export default defineAction({
  description: "Update the status of a HubSpot queue item.",
  schema: z.object({
    itemId: z.string(),
    status: z.enum(["pending", "visited", "skipped"]),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ itemId, status }) => {
    const db = getDb();
    await db
      .update(hubspotQueueItems)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(hubspotQueueItems.id, itemId));
    return { ok: true };
  },
});
