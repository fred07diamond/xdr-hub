import { defineAction } from "@agent-native/core";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { prospects } from "../server/db/schema.js";

// Paginated -- this table has no upper bound (real usage runs ~500 leads/
// day per rep), and an unbounded SELECT * here was fetching every prospect
// ever captured on every single page load regardless of how many there
// are. 200 is generous enough that most workspaces never notice pagination
// exists; "Load more" on the client just bumps offset and appends.
const DEFAULT_PAGE_SIZE = 200;

export default defineAction({
  description: "List captured LinkedIn prospects for the current user, ordered by most recent first, paginated.",
  schema: z.object({
    limit: z.number().int().min(1).max(500).default(DEFAULT_PAGE_SIZE),
    offset: z.number().int().min(0).default(0),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ limit, offset }, ctx) => {
    const db = getDb();
    const ownerFilter = ctx?.userEmail
      ? eq(prospects.ownerEmail, ctx.userEmail)
      : isNull(prospects.ownerEmail);

    const [[totalRow], rows] = await Promise.all([
      db.select({ n: count() }).from(prospects).where(ownerFilter),
      db
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
          phoneRevealRequestedAt: prospects.phoneRevealRequestedAt,
          createdAt: prospects.createdAt,
          updatedAt: prospects.updatedAt,
        })
        .from(prospects)
        .where(and(ownerFilter))
        .orderBy(desc(prospects.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    const totalCount = (totalRow?.n ?? 0) as number;
    return { prospects: rows, totalCount, hasMore: offset + rows.length < totalCount };
  },
});
