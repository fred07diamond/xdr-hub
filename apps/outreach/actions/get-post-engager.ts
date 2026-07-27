import { defineAction } from "@agent-native/core";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { postEngagements } from "../server/db/schema.js";
import { resolveOwner } from "../server/helpers/resolve-owner.js";

export default defineAction({
  description: "Return the current status and verdict for a loaded post engager. Poll until status is 'done'.",
  schema: z.object({
    id: z.string().describe("Engager record id returned by ingest-post-engager"),
    apiToken: z.string().nullish(),
  }),
  http: { method: "GET" },
  readOnly: true,
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: true, requiresAuth: false },
  run: async ({ id, apiToken }, ctx) => {
    const db = getDb();
    const ownerEmail = await resolveOwner(apiToken, ctx);
    const ownerFilter = ownerEmail
      ? eq(postEngagements.ownerEmail, ownerEmail)
      : isNull(postEngagements.ownerEmail);

    const rows = await db
      .select()
      .from(postEngagements)
      .where(and(eq(postEngagements.id, id), ownerFilter))
      .limit(1);

    if (!rows[0]) return { status: "not_found" as const };
    return rows[0];
  },
});
