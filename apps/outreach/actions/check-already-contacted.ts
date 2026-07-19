import { defineAction } from "@agent-native/core";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { sendHistory } from "../server/db/schema.js";
import { resolveOwner } from "../server/helpers/resolve-owner.js";

export default defineAction({
  description:
    "Check whether the user has already sent a connection request to this profile. Returns { contacted: boolean }.",
  schema: z.object({
    profileUrl: z.string().describe("LinkedIn profile URL"),
    apiToken: z.string().nullish().describe("Personal API token"),
  }),
  http: { method: "GET" },
  readOnly: true,
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: true, requiresAuth: false },
  run: async ({ profileUrl, apiToken }, ctx) => {
    const db = getDb();
    const ownerEmail = await resolveOwner(apiToken, ctx);
    const ownerFilter = ownerEmail
      ? eq(sendHistory.ownerEmail, ownerEmail)
      : isNull(sendHistory.ownerEmail);

    const row = await db
      .select({ id: sendHistory.id })
      .from(sendHistory)
      .where(and(eq(sendHistory.profileUrl, profileUrl), ownerFilter))
      .limit(1);

    return { contacted: row.length > 0 };
  },
});
