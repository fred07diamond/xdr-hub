import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { hubspotQueues } from "../server/db/schema.js";

export default defineAction({
  description: "List all HubSpot outreach queues for the current user.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_input, ctx) => {
    const db = getDb();
    const queues = await db
      .select()
      .from(hubspotQueues)
      .where(eq(hubspotQueues.ownerEmail, ctx!.userEmail));
    return { queues };
  },
});
