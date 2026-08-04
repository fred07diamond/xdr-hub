import { defineAction } from "@agent-native/core";
import { sql } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { contacts } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Header stats for the Contacts home page: how many contacts entered the pool in the last 24h.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_input, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    // "New today" = createdAt within the last 24h. createdAt (unlike
    // syncedAt) is set once at first insert and never bumped on re-sync/
    // re-score, so it genuinely answers "when did this contact first enter
    // our pool" rather than "when was it last touched."
    const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [newTodayRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(contacts)
      .where(sql`${contacts.createdAt} >= ${cutoffIso}`);

    return { newTodayCount: Number(newTodayRow?.count ?? 0) };
  },
});
