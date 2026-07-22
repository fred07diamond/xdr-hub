// apps/outreach/actions/rename-canvas.ts
import { defineAction } from "@agent-native/core";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { messagingCanvases } from "../server/db/schema.js";

export default defineAction({
  description: "Rename a user-owned messaging canvas.",
  schema: z.object({
    id: z.string(),
    name: z.string().min(1).max(80),
  }),
  requiresAuth: true,
  run: async ({ id, name }, ctx) => {
    const db = getDb();
    const ownerEmail = ctx!.userEmail!;

    const row = await db
      .select({ isSystem: messagingCanvases.isSystem, ownerEmail: messagingCanvases.ownerEmail })
      .from(messagingCanvases)
      .where(eq(messagingCanvases.id, id))
      .limit(1);

    if (!row[0]) return { ok: false, error: "Canvas not found." };
    if (row[0].isSystem) return { ok: false, error: "System canvases cannot be renamed." };
    if (row[0].ownerEmail !== ownerEmail) return { ok: false, error: "Not authorized." };

    await db
      .update(messagingCanvases)
      .set({ name, updatedAt: new Date().toISOString() })
      .where(and(eq(messagingCanvases.id, id), eq(messagingCanvases.ownerEmail, ownerEmail)));

    return { ok: true };
  },
});
