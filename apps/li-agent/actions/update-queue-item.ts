import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { hubspotQueues, hubspotQueueItems } from "../server/db/schema.js";

export default defineAction({
  description: "Update the status of a HubSpot queue item.",
  schema: z.object({
    itemId: z.string(),
    status: z.enum(["pending", "visited", "skipped"]),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ itemId, status }, ctx) => {
    const db = getDb();
    // Verify the item exists and belongs to the requesting user's queue
    const itemRows = await db.select().from(hubspotQueueItems).where(eq(hubspotQueueItems.id, itemId));
    const item = itemRows[0];
    if (!item) throw new Error("Item not found");
    const queueRows = await db.select().from(hubspotQueues).where(eq(hubspotQueues.id, item.queueId));
    if (!queueRows[0] || queueRows[0].ownerEmail !== ctx!.userEmail) throw new Error("Not authorized");

    await db
      .update(hubspotQueueItems)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(hubspotQueueItems.id, itemId));
    return { ok: true };
  },
});
