import { defineAction } from "@agent-native/core";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { feedback } from "../server/db/schema.js";
import { requireAdmin } from "../server/helpers/require-admin.js";

export default defineAction({
  description: "List all user feedback submissions, newest first. Admin only.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    await requireAdmin(ctx);
    const db = getDb();
    const rows = await db
      .select({
        id: feedback.id,
        userEmail: feedback.userEmail,
        message: feedback.message,
        createdAt: feedback.createdAt,
      })
      .from(feedback)
      .orderBy(desc(feedback.createdAt));
    return { feedback: rows };
  },
});
