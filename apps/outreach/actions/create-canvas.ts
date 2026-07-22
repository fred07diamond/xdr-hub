// apps/outreach/actions/create-canvas.ts
import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { messagingCanvases, messagingNodes } from "../server/db/schema.js";
import { SYSTEM_CANVAS_IDS } from "../server/helpers/seed-system-canvases.js";

const TEMPLATE_NAMES: Record<string, string> = {
  account:  "Account Messaging",
  role:     "Role Messaging",
  prospect: "Prospect Messaging",
  blank:    "Blank",
};

export default defineAction({
  description: "Create a new user canvas by copying a system template. Returns the new canvas id and name.",
  schema: z.object({
    templateSlug: z.enum(["account", "role", "prospect", "blank"]),
    name: z.string().min(1).max(80).optional(),
  }),
  requiresAuth: true,
  run: async ({ templateSlug, name: nameArg }, ctx) => {
    const db = getDb();
    const ownerEmail = ctx!.userEmail!;
    const now = new Date().toISOString();

    // Auto-increment name if user already has a canvas with the default name
    let name = nameArg ?? TEMPLATE_NAMES[templateSlug] ?? "Canvas";
    const existing = await db
      .select({ name: messagingCanvases.name })
      .from(messagingCanvases)
      .where(eq(messagingCanvases.ownerEmail, ownerEmail));
    const existingNames = new Set(existing.map((r) => r.name));
    let suffix = 2;
    let candidate = name;
    while (existingNames.has(candidate)) {
      candidate = `${name} ${suffix++}`;
    }
    name = candidate;

    const canvasId = nanoid();
    await db.insert(messagingCanvases).values({
      id: canvasId,
      name,
      templateSlug,
      isSystem: 0,
      ownerEmail,
      createdAt: now,
      updatedAt: now,
    });

    // Copy template nodes into the new canvas (skip blank)
    if (templateSlug !== "blank") {
      const systemCanvasId = SYSTEM_CANVAS_IDS[templateSlug as keyof typeof SYSTEM_CANVAS_IDS];
      const templateNodes = await db
        .select()
        .from(messagingNodes)
        .where(eq(messagingNodes.canvasId, systemCanvasId));

      for (const n of templateNodes) {
        await db.insert(messagingNodes).values({
          ...n,
          id: nanoid(),
          ownerEmail,
          canvasId,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    return { id: canvasId, name };
  },
});
