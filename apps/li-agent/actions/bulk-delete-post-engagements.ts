import { defineAction } from "@agent-native/core";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { postEngagements } from "../server/db/schema.js";

export default defineAction({
  description: "Permanently delete multiple post engagements by ID.",
  schema: z.object({ ids: z.array(z.string()).min(1) }),
  run: async ({ ids }, ctx) => {
    const db = getDb();
    const ownerFilter = ctx?.userEmail
      ? eq(postEngagements.ownerEmail, ctx.userEmail)
      : isNull(postEngagements.ownerEmail);
    await db.delete(postEngagements).where(and(inArray(postEngagements.id, ids), ownerFilter));
    return { ok: true, deleted: ids.length };
  },
});
