import { defineAction } from "@agent-native/core";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { prospects } from "../server/db/schema.js";

export default defineAction({
  description: "List all captured LinkedIn prospects for the current user, ordered by most recent first.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    const db = getDb();
    const ownerFilter = ctx?.userEmail
      ? eq(prospects.ownerEmail, ctx.userEmail)
      : isNull(prospects.ownerEmail);

    const rows = await db
      .select({
        id: prospects.id,
        profileUrl: prospects.profileUrl,
        name: prospects.name,
        headline: prospects.headline,
        role: prospects.role,
        company: prospects.company,
        fitVerdict: prospects.fitVerdict,
        fitReason: prospects.fitReason,
        draftNote: prospects.draftNote,
        draftFollowUp: prospects.draftFollowUp,
        personaName: prospects.personaName,
        personaColor: prospects.personaColor,
        rating: prospects.rating,
        ratingNote: prospects.ratingNote,
        status: prospects.status,
        enrichmentStatus: prospects.enrichmentStatus,
        enrichedEmail: prospects.enrichedEmail,
        enrichedTitle: prospects.enrichedTitle,
        enrichedPhone: prospects.enrichedPhone,
        enrichedLinkedinUrl: prospects.enrichedLinkedinUrl,
        enrichedCompanyIndustry: prospects.enrichedCompanyIndustry,
        enrichedCompanySize: prospects.enrichedCompanySize,
        enrichmentError: prospects.enrichmentError,
        phoneRevealStatus: prospects.phoneRevealStatus,
        createdAt: prospects.createdAt,
        updatedAt: prospects.updatedAt,
      })
      .from(prospects)
      .where(and(ownerFilter))
      .orderBy(desc(prospects.createdAt));

    return { prospects: rows };
  },
});
