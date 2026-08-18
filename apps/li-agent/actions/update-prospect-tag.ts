import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { prospectTags } from "../server/db/schema.js";

export default defineAction({
  description: "Rename and/or recolor an existing prospect tag.",
  schema: z.object({
    id: z.string(),
    name: z.string().min(1).max(40).optional(),
    color: z.string().min(1).max(20).optional(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ id, name, color }, ctx) => {
    const db = getDb();
    const rows = await db.select().from(prospectTags).where(eq(prospectTags.id, id));
    if (!rows[0] || rows[0].ownerEmail !== ctx!.userEmail) return { ok: false, error: "Tag not found." };

    const patch: { name?: string; color?: string; updatedAt: string } = { updatedAt: new Date().toISOString() };
    if (name !== undefined) patch.name = name.trim();
    if (color !== undefined) patch.color = color;

    await db.update(prospectTags).set(patch).where(eq(prospectTags.id, id));
    return { ok: true };
  },
});
