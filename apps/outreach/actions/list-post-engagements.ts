// apps/outreach/actions/list-post-engagements.ts
import { defineAction } from "@agent-native/core";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { postEngagements } from "../server/db/schema.js";

export default defineAction({
  description: "List all post engagements for the current user, optionally filtered by post URL.",
  schema: z.object({
    postUrl: z.string().nullish().describe("Filter to a specific LinkedIn post URL"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ postUrl }, ctx) => {
    const db = getDb();
    const ownerFilter = ctx?.userEmail
      ? eq(postEngagements.ownerEmail, ctx.userEmail)
      : isNull(postEngagements.ownerEmail);

    const conditions = postUrl
      ? and(ownerFilter, eq(postEngagements.postUrl, postUrl))
      : ownerFilter;

    const rows = await db
      .select()
      .from(postEngagements)
      .where(conditions)
      .orderBy(desc(postEngagements.createdAt));

    return { engagements: rows };
  },
});
