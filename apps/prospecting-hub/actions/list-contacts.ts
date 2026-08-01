import { defineAction } from "@agent-native/core";
import { and, desc, eq, inArray, or, sql } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { contacts, personas, segmentContacts, segments } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

export default defineAction({
  description: "List synced contacts (master pool, across all sources) with persona/score/segment-membership info, filterable and paginated.",
  schema: z.object({
    search: z.string().nullish().describe("Matches name or company, case-insensitive substring"),
    personaId: z.string().nullish(),
    source: z.enum(["hubspot", "commonroom", "prospector"]).nullish(),
    status: z.enum(["active", "actioned"]).nullish(),
    limit: z.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
    offset: z.number().int().min(0).default(0),
  }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ search, personaId, source, status, limit, offset }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    const conditions = [
      personaId ? eq(contacts.personaId, personaId) : undefined,
      source ? eq(contacts.source, source) : undefined,
      status ? eq(contacts.status, status) : undefined,
      search
        ? or(
            sql`lower(${contacts.name}) LIKE ${`%${search.toLowerCase()}%`}`,
            sql`lower(${contacts.company}) LIKE ${`%${search.toLowerCase()}%`}`,
          )
        : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);
    const whereClause = conditions.length ? and(...conditions) : undefined;

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)` })
      .from(contacts)
      .where(whereClause);

    const rows = await db
      .select({
        id: contacts.id,
        name: contacts.name,
        title: contacts.title,
        company: contacts.company,
        email: contacts.email,
        linkedinUrl: contacts.linkedinUrl,
        hubspotUrl: contacts.hubspotUrl,
        source: contacts.source,
        status: contacts.status,
        personaMatchScore: contacts.personaMatchScore,
        companyFitScore: contacts.companyFitScore,
        engagementScore: contacts.engagementScore,
        overallScore: contacts.overallScore,
        scoreReasoning: contacts.scoreReasoning,
        personaId: contacts.personaId,
        personaName: personas.name,
        personaColor: personas.color,
        syncedAt: contacts.syncedAt,
      })
      .from(contacts)
      .leftJoin(personas, eq(contacts.personaId, personas.id))
      .where(whereClause)
      .orderBy(desc(sql`coalesce(${contacts.personaMatchScore}, -1)`), desc(contacts.syncedAt))
      .limit(limit)
      .offset(offset);

    if (rows.length === 0) {
      return { contacts: [], total: Number(total), hasMore: false };
    }

    const memberships = await db
      .select({ contactId: segmentContacts.contactId, segmentId: segmentContacts.segmentId, segmentName: segments.name })
      .from(segmentContacts)
      .innerJoin(segments, eq(segmentContacts.segmentId, segments.id))
      .where(inArray(segmentContacts.contactId, rows.map((r) => r.id)));

    const segmentsByContact = new Map<string, Array<{ id: string; name: string }>>();
    for (const m of memberships) {
      const list = segmentsByContact.get(m.contactId) ?? [];
      list.push({ id: m.segmentId, name: m.segmentName });
      segmentsByContact.set(m.contactId, list);
    }

    return {
      contacts: rows.map((r) => ({ ...r, segments: segmentsByContact.get(r.id) ?? [] })),
      total: Number(total),
      hasMore: offset + rows.length < Number(total),
    };
  },
});
