import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { messagingEdges } from "../server/db/schema.js";

export default defineAction({
  description: "Delete a messaging edge by its id.",
  schema: z.object({ id: z.string() }),
  requiresAuth: true,
  run: async ({ id }) => {
    const db = getDb();
    await db.delete(messagingEdges).where(eq(messagingEdges.id, id));
    return { ok: true };
  },
});
