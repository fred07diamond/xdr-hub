import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { prospectTags, prospectTagLinks } from "../server/db/schema.js";

export default defineAction({
  description: "Delete a prospect tag and remove it from every prospect it's applied to.",
  schema: z.object({ id: z.string() }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ id }, ctx) => {
    const db = getDb();
    const rows = await db.select().from(prospectTags).where(eq(prospectTags.id, id));
    if (!rows[0] || rows[0].ownerEmail !== ctx!.userEmail) return { ok: false, error: "Tag not found." };

    await db.delete(prospectTagLinks).where(eq(prospectTagLinks.tagId, id));
    await db.delete(prospectTags).where(eq(prospectTags.id, id));
    return { ok: true };
  },
});
