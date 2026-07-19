import { defineAction } from "@agent-native/core";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { prospects } from "../server/db/schema.js";

export default defineAction({
  description: "Permanently delete multiple prospects by ID.",
  schema: z.object({ ids: z.array(z.string()).min(1) }),
  run: async ({ ids }, ctx) => {
    const db = getDb();
    const ownerFilter = ctx?.userEmail
      ? eq(prospects.ownerEmail, ctx.userEmail)
      : isNull(prospects.ownerEmail);
    await db.delete(prospects).where(and(inArray(prospects.id, ids), ownerFilter));
    return { ok: true, deleted: ids.length };
  },
});
