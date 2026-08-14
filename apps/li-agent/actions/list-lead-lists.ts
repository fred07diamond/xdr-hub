import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadLists } from "../server/db/schema.js";

export default defineAction({
  description: "List all Sales Navigator lead lists for the current user.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_input, ctx) => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) return { lists: [] };
    const db = getDb();
    const lists = await db
      .select()
      .from(leadLists)
      .where(eq(leadLists.ownerEmail, userEmail));
    return { lists };
  },
});
