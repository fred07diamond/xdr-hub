import { defineAction } from "@agent-native/core";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { prospects } from "../server/db/schema.js";

export default defineAction({
  description: "Permanently delete a prospect by ID.",
  schema: z.object({ id: z.string() }),
  run: async ({ id }, ctx) => {
    const db = getDb();
    const ownerFilter = ctx?.userEmail
      ? eq(prospects.ownerEmail, ctx.userEmail)
      : isNull(prospects.ownerEmail);
    await db.delete(prospects).where(and(eq(prospects.id, id), ownerFilter));
    return { ok: true };
  },
});
