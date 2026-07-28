import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { feedback } from "../server/db/schema.js";
import { requireAdmin } from "../server/helpers/require-admin.js";

export default defineAction({
  description: "Mark a feedback entry as resolved (or un-resolve it). Admin only.",
  schema: z.object({
    id: z.string(),
    resolved: z.boolean().default(true),
  }),
  run: async ({ id, resolved }, ctx) => {
    await requireAdmin(ctx);
    const db = getDb();
    await db
      .update(feedback)
      .set({ resolvedAt: resolved ? new Date().toISOString() : null })
      .where(eq(feedback.id, id));
    return { ok: true };
  },
});
