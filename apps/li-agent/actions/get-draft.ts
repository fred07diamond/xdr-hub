import { defineAction } from "@agent-native/core";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { prospects } from "../server/db/schema.js";
import { resolveOwner } from "../server/helpers/resolve-owner.js";

export default defineAction({
  description:
    "Return the current draft status and note for a captured LinkedIn profile. Poll this after capture-profile until status is 'drafted'.",
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
      ? eq(prospects.ownerEmail, ownerEmail)
      : isNull(prospects.ownerEmail);

    const row = await db
      .select({
        status: prospects.status,
        fitVerdict: prospects.fitVerdict,
        fitReason: prospects.fitReason,
        draftNote: prospects.draftNote,
        draftFollowUp: prospects.draftFollowUp,
        personaName: prospects.personaName,
        personaColor: prospects.personaColor,
        updatedAt: prospects.updatedAt,
      })
      .from(prospects)
      .where(and(eq(prospects.profileUrl, profileUrl), ownerFilter))
      .limit(1);

    if (!row[0]) return { status: "not_found" };
    return row[0];
  },
});
