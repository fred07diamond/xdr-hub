import { defineAction } from "@agent-native/core";
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { prospects, prospectTags, prospectTagLinks } from "../server/db/schema.js";

export default defineAction({
  description: "Apply one tag to many prospects at once, e.g. from a multi-select in the Prospects table. Skips prospects that already have the tag.",
  schema: z.object({
    prospectIds: z.array(z.string()).min(1),
    tagId: z.string(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ prospectIds, tagId }, ctx) => {
    const db = getDb();
    const ownerEmail = ctx!.userEmail!;

    const tagRows = await db.select().from(prospectTags).where(eq(prospectTags.id, tagId));
    if (!tagRows[0] || tagRows[0].ownerEmail !== ownerEmail) return { ok: false, error: "Tag not found." };

    const ownedProspects = await db
      .select({ id: prospects.id })
      .from(prospects)
      .where(and(inArray(prospects.id, prospectIds), eq(prospects.ownerEmail, ownerEmail)));
    const ownedIds = ownedProspects.map((p) => p.id);
    if (!ownedIds.length) return { ok: true, tagged: 0 };

    const existingLinks = await db
      .select({ prospectId: prospectTagLinks.prospectId })
      .from(prospectTagLinks)
      .where(and(eq(prospectTagLinks.tagId, tagId), inArray(prospectTagLinks.prospectId, ownedIds)));
    const alreadyTagged = new Set(existingLinks.map((l) => l.prospectId));
    const toInsert = ownedIds.filter((id) => !alreadyTagged.has(id));

    if (toInsert.length) {
      const now = new Date().toISOString();
      await db.insert(prospectTagLinks).values(toInsert.map((prospectId) => ({ id: nanoid(), prospectId, tagId, createdAt: now })));
    }

    return { ok: true, tagged: toInsert.length };
  },
});
