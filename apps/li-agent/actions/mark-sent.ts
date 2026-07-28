import { defineAction } from "@agent-native/core";
import { nanoid } from "nanoid";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { prospects, sendHistory } from "../server/db/schema.js";
import { resolveOwner } from "../server/helpers/resolve-owner.js";

export default defineAction({
  description:
    "Record that the user manually sent a connection request for a profile. Updates the prospect status to 'sent' and writes a send_history row.",
  schema: z.object({
    profileUrl: z.string().describe("LinkedIn profile URL"),
    apiToken: z.string().nullish().describe("Personal API token"),
  }),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: false, requiresAuth: false },
  run: async ({ profileUrl, apiToken }, ctx) => {
    const db = getDb();
    const now = new Date().toISOString();
    const ownerEmail = await resolveOwner(apiToken, ctx);
    const ownerFilter = ownerEmail
      ? eq(prospects.ownerEmail, ownerEmail)
      : isNull(prospects.ownerEmail);

    await Promise.all([
      db.update(prospects).set({ status: "sent", updatedAt: now }).where(and(eq(prospects.profileUrl, profileUrl), ownerFilter)),
      db.insert(sendHistory).values({ id: nanoid(), ownerEmail, profileUrl, sentAt: now }),
    ]);

    return { ok: true };
  },
});
