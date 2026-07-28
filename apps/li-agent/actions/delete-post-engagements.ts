import { defineAction } from "@agent-native/core";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { postEngagements } from "../server/db/schema.js";

export default defineAction({
  description: "Delete all post engagements for a given post URL, effectively removing the post and all its engagers.",
  schema: z.object({ postUrl: z.string().url() }),
  run: async ({ postUrl }, ctx) => {
    const db = getDb();
    const ownerFilter = ctx?.userEmail
      ? eq(postEngagements.ownerEmail, ctx.userEmail)
      : isNull(postEngagements.ownerEmail);
    const result = await db
      .delete(postEngagements)
      .where(and(eq(postEngagements.postUrl, postUrl), ownerFilter));
    return { ok: true };
  },
});
