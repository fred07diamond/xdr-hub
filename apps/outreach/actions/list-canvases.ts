// apps/outreach/actions/list-canvases.ts
import { defineAction } from "@agent-native/core";
import { asc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { messagingCanvases } from "../server/db/schema.js";
import { resolveOwner } from "../server/helpers/resolve-owner.js";
import { seedSystemCanvases } from "../server/helpers/seed-system-canvases.js";

export default defineAction({
  description: "List all messaging canvases visible to the caller: system templates plus their own canvases.",
  schema: z.object({
    apiToken: z.string().nullish(),
  }),
  http: { method: "GET" },
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: true, requiresAuth: false },
  run: async ({ apiToken }, ctx) => {
    const db = getDb();
    await seedSystemCanvases(db);

    const ownerEmail = await resolveOwner(apiToken, ctx);

    const rows = await db
      .select({
        id: messagingCanvases.id,
        name: messagingCanvases.name,
        templateSlug: messagingCanvases.templateSlug,
        isSystem: messagingCanvases.isSystem,
        createdAt: messagingCanvases.createdAt,
      })
      .from(messagingCanvases)
      .where(
        ownerEmail
          ? or(eq(messagingCanvases.isSystem, 1), eq(messagingCanvases.ownerEmail, ownerEmail))
          : eq(messagingCanvases.isSystem, 1),
      )
      .orderBy(asc(messagingCanvases.isSystem), asc(messagingCanvases.createdAt));

    return { canvases: rows };
  },
});
