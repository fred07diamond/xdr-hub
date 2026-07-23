import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { hubspotQueues, hubspotQueueItems } from "../server/db/schema.js";

export default defineAction({
  description: "Get the contacts in a HubSpot outreach queue.",
  schema: z.object({ queueId: z.string() }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ queueId }, ctx) => {
    const db = getDb();
    const queueRows = await db
      .select()
      .from(hubspotQueues)
      .where(eq(hubspotQueues.id, queueId));
    const queue = queueRows[0];
    if (!queue || queue.ownerEmail !== ctx!.userEmail) throw new Error("Queue not found");
    const items = await db
      .select()
      .from(hubspotQueueItems)
      .where(eq(hubspotQueueItems.queueId, queueId))
      .orderBy(hubspotQueueItems.position);
    return { queue, items };
  },
});
