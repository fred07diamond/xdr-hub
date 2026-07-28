import { defineAction } from "@agent-native/core";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { prospects } from "../server/db/schema.js";

export default defineAction({
  description: "Rate a drafted connection note as helpful (1) or unhelpful (-1), with an optional note about what was off.",
  schema: z.object({
    id: z.string(),
    rating: z.union([z.literal(1), z.literal(-1)]),
    ratingNote: z.string().nullish(),
  }),
  run: async ({ id, rating, ratingNote }, ctx) => {
    const db = getDb();
    const ownerFilter = ctx?.userEmail
      ? eq(prospects.ownerEmail, ctx.userEmail)
      : isNull(prospects.ownerEmail);

    const existing = await db
      .select({ id: prospects.id })
      .from(prospects)
      .where(and(eq(prospects.id, id), ownerFilter))
      .limit(1);

    if (!existing[0]) throw new Error("Prospect not found or access denied");

    await db
      .update(prospects)
      .set({
        rating,
        ratingNote: ratingNote ?? null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(prospects.id, id));

    return { ok: true };
  },
});
