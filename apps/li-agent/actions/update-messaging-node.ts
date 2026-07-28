import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { messagingNodes } from "../server/db/schema.js";
import { requireAdmin } from "../server/helpers/require-admin.js";

export default defineAction({
  description: "Update a messaging node's content or canvas position.",
  schema: z.object({
    id: z.string(),
    title: z.string().min(1).max(120).optional(),
    personaId: z.string().nullable().optional(),
    tone: z.string().nullable().optional(),
    valueProps: z.string().nullable().optional(),
    phrasesToUse: z.string().nullable().optional(),
    phrasesToAvoid: z.string().nullable().optional(),
    exampleNotes: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    positionX: z.number().int().optional(),
    positionY: z.number().int().optional(),
  }),
  requiresAuth: true,
  run: async ({ id, ...fields }, ctx) => {
    const db = getDb();

    const row = await db
      .select({ type: messagingNodes.type, ownerEmail: messagingNodes.ownerEmail })
      .from(messagingNodes)
      .where(eq(messagingNodes.id, id))
      .limit(1);

    if (!row[0]) return { ok: false, error: "Node not found" };

    // Persona and global node content is admin-only; position updates are allowed for all.
    const contentFields = ["title", "tone", "valueProps", "phrasesToUse", "phrasesToAvoid", "exampleNotes", "notes", "personaId"];
    const updatingContent = contentFields.some((k) => fields[k as keyof typeof fields] !== undefined);
    if ((row[0].type === "global" || row[0].type === "persona") && updatingContent) {
      await requireAdmin(ctx);
    } else if (row[0].type !== "global" && row[0].type !== "persona") {
      // Fine-tuning nodes are owned — only the owner may edit them
      if (row[0].ownerEmail !== ctx!.userEmail) {
        return { ok: false, error: "Not authorized to edit this node." };
      }
    }

    await db
      .update(messagingNodes)
      .set({ ...fields, updatedAt: new Date().toISOString() })
      .where(eq(messagingNodes.id, id));

    return { ok: true };
  },
});
