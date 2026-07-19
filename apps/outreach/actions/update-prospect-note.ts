import { defineAction } from "@agent-native/core";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { prospects } from "../server/db/schema.js";

export default defineAction({
  description: "Update the draft note and optional follow-up for a prospect.",
  schema: z.object({
    id: z.string(),
    draftNote: z.string(),
    draftFollowUp: z.string().nullish(),
  }),
  run: async ({ id, draftNote, draftFollowUp }, ctx) => {
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
        draftNote,
        draftFollowUp: draftFollowUp ?? null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(prospects.id, id));
    return { ok: true };
  },
});
