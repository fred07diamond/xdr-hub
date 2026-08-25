import { defineAction } from "@agent-native/core";
import { and, desc, eq, inArray, or, sql } from "@agent-native/core/db/schema";
import { getSharedDb, sharedPersonas } from "@xdr-hub/shared/server";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { contacts, segmentContacts, segments } from "../server/db/schema.js";
import { assertSegmentReadable } from "../server/helpers/segment-access.js";
import { requireRole } from "../server/helpers/require-role.js";

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

const SORTABLE_COLUMNS = {
  name: contacts.name,
  company: contacts.company,
  overallScore: sql`coalesce(${contacts.overallScore}, -1)`,
  personaMatchScore: sql`coalesce(${contacts.personaMatchScore}, -1)`,
  companyFitScore: sql`coalesce(${contacts.companyFitScore}, -1)`,
  engagementScore: sql`coalesce(${contacts.engagementScore}, -1)`,
  source: contacts.source,
  status: contacts.status,
  syncedAt: contacts.syncedAt,
} as const;

export default defineAction({
  description: "List synced contacts (master pool, across all sources) with persona/score/segment-membership info, filterable, sortable, and paginated.",
  schema: z.object({
    search: z.string().nullish().describe("Matches name or company, case-insensitive substring"),
    personaId: z.string().nullish(),
    source: z.enum(["hubspot", "commonroom", "prospector"]).nullish(),
    status: z.enum(["active", "actioned"]).nullish(),
    segmentId: z.string().nullish().describe("Scope results to only contacts that are members of this segment (list), ANDed with any other filters"),
    ids: z.array(z.string()).nullish().describe("Scope results to exactly these contact ids, ANDed with any other filters — used for exporting a specific multi-selected set regardless of current pagination"),
    sortBy: z.enum(Object.keys(SORTABLE_COLUMNS) as [keyof typeof SORTABLE_COLUMNS]).nullish(),
    sortDirection: z.enum(["asc", "desc"]).nullish(),
    limit: z.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
    offset: z.number().int().min(0).default(0),
  }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ search, personaId, source, status, segmentId, ids, sortBy, sortDirection, limit, offset }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    // Same row-level-security check get-segment.ts already runs before
    // handing back a segment's contacts — without it, a `segmentId` filter
    // here would let any authenticated xdr/ae/admin read the membership of
    // a private segment they don't own just by guessing/knowing its id,
    // bypassing the "private unless owner/admin" rule entirely.
    if (segmentId) {
      await assertSegmentReadable(segmentId, ctx!.userEmail!, db);
    }

    const conditions = [
      personaId ? eq(contacts.personaId, personaId) : undefined,
      source ? eq(contacts.source, source) : undefined,
      status ? eq(contacts.status, status) : undefined,
      ids && ids.length ? inArray(contacts.id, ids) : undefined,
      // Correlated EXISTS rather than resolving segment membership to an id
      // list first — this app has hit real bugs from passing an empty id
      // array into `inArray` (undefined-behavior SQL on some backends; see
      // run-sourcing-rule-pipeline.ts's own note on this). EXISTS sidesteps
      // that landmine entirely: an empty/no-match segment just yields zero
      // rows like any other over-narrow filter, never an invalid query.
      segmentId
        ? sql`EXISTS (SELECT 1 FROM ${segmentContacts} WHERE ${segmentContacts.contactId} = ${contacts.id} AND ${segmentContacts.segmentId} = ${segmentId})`
        : undefined,
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
        hubspotQlScore: contacts.hubspotQlScore,
        commonRoomIntentScore: contacts.commonRoomIntentScore,
        commonRoomCompanyFitScore: contacts.commonRoomCompanyFitScore,
        apolloCompanyFitScore: contacts.apolloCompanyFitScore,
        apolloIntentScore: contacts.apolloIntentScore,
        overallScore: contacts.overallScore,
        scoreReasoning: contacts.scoreReasoning,
        personaId: contacts.personaId,
        syncedAt: contacts.syncedAt,
      })
      .from(contacts)
      .where(whereClause)
      .orderBy(
        ...(sortBy
          ? [sortDirection === "asc" ? sql`${SORTABLE_COLUMNS[sortBy]} ASC` : desc(SORTABLE_COLUMNS[sortBy])]
          : [desc(sql`coalesce(${contacts.overallScore}, -1)`), desc(contacts.syncedAt)]),
      )
      .limit(limit)
      .offset(offset);

    if (rows.length === 0) {
      return { contacts: [], total: Number(total), hasMore: false };
    }

    // Personas live in the shared cross-app DB now -- can't join it in the
    // same query as this app's own local `contacts` table, so fetch the
    // distinct referenced persona ids and merge name/color in application
    // code (same "separate query + Map merge" idiom list-personas.ts uses
    // for its own sub-persona/library-doc counts).
    const personaIds = [...new Set(rows.map((r) => r.personaId).filter((id): id is string => !!id))];
    const personaRows = personaIds.length
      ? await getSharedDb()
          .select({ id: sharedPersonas.id, name: sharedPersonas.name, color: sharedPersonas.color })
          .from(sharedPersonas)
          .where(inArray(sharedPersonas.id, personaIds))
      : [];
    const personaById = new Map(personaRows.map((p) => [p.id, p]));

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
      contacts: rows.map((r) => ({
        ...r,
        personaName: r.personaId ? (personaById.get(r.personaId)?.name ?? null) : null,
        personaColor: r.personaId ? (personaById.get(r.personaId)?.color ?? null) : null,
        segments: segmentsByContact.get(r.id) ?? [],
      })),
      total: Number(total),
      hasMore: offset + rows.length < Number(total),
    };
  },
});
