import { defineAction } from "@agent-native/core";
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { prospects, prospectTags, prospectTagLinks } from "../server/db/schema.js";

export default defineAction({
  description: "Set the full list of tags applied to a prospect, replacing whatever was there before.",
  schema: z.object({
    prospectId: z.string(),
    tagIds: z.array(z.string()),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ prospectId, tagIds }, ctx) => {
    const db = getDb();
    const ownerEmail = ctx!.userEmail!;

    const prospectRows = await db.select({ id: prospects.id }).from(prospects).where(and(eq(prospects.id, prospectId), eq(prospects.ownerEmail, ownerEmail)));
    if (!prospectRows[0]) return { ok: false, error: "Prospect not found." };

    if (tagIds.length) {
      const ownedTags = await db
        .select({ id: prospectTags.id })
        .from(prospectTags)
        .where(and(inArray(prospectTags.id, tagIds), eq(prospectTags.ownerEmail, ownerEmail)));
      if (ownedTags.length !== tagIds.length) return { ok: false, error: "One or more tags weren't found." };
    }

    const now = new Date().toISOString();
    await db.delete(prospectTagLinks).where(eq(prospectTagLinks.prospectId, prospectId));
    if (tagIds.length) {
      await db.insert(prospectTagLinks).values(tagIds.map((tagId) => ({ id: nanoid(), prospectId, tagId, createdAt: now })));
    }

    return { ok: true };
  },
});
