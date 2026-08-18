import { defineAction } from "@agent-native/core";
import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { prospectTags, prospectTagLinks } from "../server/db/schema.js";

export default defineAction({
  description: "List every tag the current user has created for labeling prospects, with how many prospects each is applied to.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_args, ctx) => {
    const db = getDb();
    const ownerEmail = ctx!.userEmail!;

    const rows = await db
      .select({
        id: prospectTags.id,
        name: prospectTags.name,
        color: prospectTags.color,
        prospectCount: count(prospectTagLinks.id),
      })
      .from(prospectTags)
      .leftJoin(prospectTagLinks, eq(prospectTagLinks.tagId, prospectTags.id))
      .where(eq(prospectTags.ownerEmail, ownerEmail))
      .groupBy(prospectTags.id, prospectTags.name, prospectTags.color)
      .orderBy(prospectTags.name);

    return { tags: rows };
  },
});
