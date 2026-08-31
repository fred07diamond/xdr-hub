import { defineAction } from "@agent-native/core";
import { and, desc, eq, gte, lte, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadListItems, leadLists, prospects } from "../server/db/schema.js";

export interface EnrichmentAuditRow {
  source: "prospect" | "lead_list_item";
  id: string;
  name: string | null;
  company: string | null;
  ownerEmail: string | null;
  enrichmentStatus: string;
  enrichmentSource: string | null;
  enrichedEmail: string | null;
  enrichedPhone: string | null;
  enrichmentError: string | null;
  enrichedAt: string | null;
  link: string | null;
}

// Read-only report of every prospect/lead-list-item that has ever gone
// through Apollo enrichment (attempted or successful) -- lets anyone see
// who's been enriched without needing a persistent page. Every signed-in
// workspace member can call this, same as get-analytics.
export default defineAction({
  description:
    "List every prospect and lead-list item that has been Apollo-enriched (attempted or successful), for a CSV audit export. Optionally bounded to an enrichedAt date range.",
  schema: z.object({
    // Plain "YYYY-MM-DD" from a date-picker, not a full ISO timestamp -- the
    // UI sends calendar days, so these are widened to UTC day boundaries
    // below rather than compared as-is against enrichedAt's full timestamps.
    startDate: z.string().nullish(),
    endDate: z.string().nullish(),
  }),
  requiresAuth: true,
  readOnly: true,
  run: async ({ startDate, endDate }) => {
    const db = getDb();

    const startIso = startDate ? `${startDate}T00:00:00.000Z` : null;
    const endIso = endDate ? `${endDate}T23:59:59.999Z` : null;

    const prospectRows = await db
      .select({
        id: prospects.id,
        name: prospects.name,
        company: prospects.company,
        ownerEmail: prospects.ownerEmail,
        enrichmentStatus: prospects.enrichmentStatus,
        enrichmentSource: prospects.enrichmentSource,
        enrichedEmail: prospects.enrichedEmail,
        enrichedPhone: prospects.enrichedPhone,
        enrichmentError: prospects.enrichmentError,
        enrichedAt: prospects.enrichedAt,
        profileUrl: prospects.profileUrl,
      })
      .from(prospects)
      .where(
        and(
          ne(prospects.enrichmentStatus, "idle"),
          startIso ? gte(prospects.enrichedAt, startIso) : undefined,
          endIso ? lte(prospects.enrichedAt, endIso) : undefined,
        ),
      )
      .orderBy(desc(prospects.enrichedAt));

    const leadListItemRows = await db
      .select({
        id: leadListItems.id,
        name: leadListItems.name,
        company: leadListItems.company,
        ownerEmail: leadLists.ownerEmail,
        enrichmentStatus: leadListItems.enrichmentStatus,
        enrichmentSource: leadListItems.enrichmentSource,
        enrichedEmail: leadListItems.enrichedEmail,
        enrichedPhone: leadListItems.enrichedPhone,
        enrichmentError: leadListItems.enrichmentError,
        enrichedAt: leadListItems.enrichedAt,
        profileUrl: leadListItems.profileUrl,
        salesNavLeadUrl: leadListItems.salesNavLeadUrl,
      })
      .from(leadListItems)
      .innerJoin(leadLists, eq(leadListItems.listId, leadLists.id))
      .where(
        and(
          ne(leadListItems.enrichmentStatus, "idle"),
          startIso ? gte(leadListItems.enrichedAt, startIso) : undefined,
          endIso ? lte(leadListItems.enrichedAt, endIso) : undefined,
        ),
      )
      .orderBy(desc(leadListItems.enrichedAt));

    const rows: EnrichmentAuditRow[] = [
      ...prospectRows.map((r) => ({
        source: "prospect" as const,
        id: r.id,
        name: r.name,
        company: r.company,
        ownerEmail: r.ownerEmail,
        enrichmentStatus: r.enrichmentStatus,
        enrichmentSource: r.enrichmentSource,
        enrichedEmail: r.enrichedEmail,
        enrichedPhone: r.enrichedPhone,
        enrichmentError: r.enrichmentError,
        enrichedAt: r.enrichedAt,
        link: r.profileUrl,
      })),
      ...leadListItemRows.map((r) => ({
        source: "lead_list_item" as const,
        id: r.id,
        name: r.name,
        company: r.company,
        ownerEmail: r.ownerEmail,
        enrichmentStatus: r.enrichmentStatus,
        enrichmentSource: r.enrichmentSource,
        enrichedEmail: r.enrichedEmail,
        enrichedPhone: r.enrichedPhone,
        enrichmentError: r.enrichmentError,
        enrichedAt: r.enrichedAt,
        link: r.profileUrl || r.salesNavLeadUrl,
      })),
    ].sort((a, b) => (b.enrichedAt ?? "").localeCompare(a.enrichedAt ?? ""));

    return { rows };
  },
});
