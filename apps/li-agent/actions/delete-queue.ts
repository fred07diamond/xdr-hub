import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { hubspotQueues, hubspotQueueItems } from "../server/db/schema.js";

export default defineAction({
  description: "Delete a HubSpot outreach queue and all its items.",
  schema: z.object({ queueId: z.string() }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ queueId }, ctx) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(hubspotQueues)
      .where(eq(hubspotQueues.id, queueId));
    if (!rows[0] || rows[0].ownerEmail !== ctx!.userEmail) throw new Error("Queue not found");
    await db.delete(hubspotQueueItems).where(eq(hubspotQueueItems.queueId, queueId));
    await db.delete(hubspotQueues).where(eq(hubspotQueues.id, queueId));
    return { ok: true };
  },
});
