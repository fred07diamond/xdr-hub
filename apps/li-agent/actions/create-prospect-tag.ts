import { defineAction } from "@agent-native/core";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { prospectTags } from "../server/db/schema.js";

export default defineAction({
  description: "Create a new tag for labeling prospects.",
  schema: z.object({
    name: z.string().min(1).max(40),
    color: z.string().min(1).max(20),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ name, color }, ctx) => {
    const db = getDb();
    const ownerEmail = ctx!.userEmail!;
    const trimmed = name.trim();

    const existing = await db
      .select({ id: prospectTags.id })
      .from(prospectTags)
      .where(and(eq(prospectTags.ownerEmail, ownerEmail), eq(prospectTags.name, trimmed)))
      .limit(1);
    if (existing[0]) return { ok: false, error: `A tag named "${trimmed}" already exists.` };

    const id = nanoid();
    const now = new Date().toISOString();
    await db.insert(prospectTags).values({ id, ownerEmail, name: trimmed, color, createdAt: now, updatedAt: now });

    return { ok: true, tag: { id, name: trimmed, color, prospectCount: 0 } };
  },
});
