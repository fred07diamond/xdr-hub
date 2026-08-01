import { defineAction } from "@agent-native/core";
import { and, eq, sql } from "@agent-native/core/db/schema";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { contacts, personas, segmentContacts, segments } from "../server/db/schema.js";
import { logAnalyticsEvent } from "../server/helpers/analytics.js";
import { deriveProspectorFilters } from "../server/helpers/derive-prospector-filters.js";
import { searchProspectorContacts } from "../server/helpers/prospector-client.js";
import { requireRole } from "../server/helpers/require-role.js";
import { scoreContactAgainstPersonas } from "../server/helpers/score-contact.js";

export default defineAction({
  description:
    "Search CommonRoom Prospector for a persona's target contacts, upsert them into the contact pool (source: prospector), score each against personas, and add them to a segment.",
  schema: z.object({
    personaId: z.string().min(1),
    subPersonaId: z.string().nullish(),
    companyAllowList: z.array(z.string()).nullish(),
    companyDenyList: z.array(z.string()).nullish(),
    limit: z.number().int().min(1).max(200).default(20),
    segmentId: z.string().min(1),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ personaId, subPersonaId, companyAllowList, companyDenyList, limit, segmentId }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();
    const userEmail = ctx!.userEmail!;

    const segment = await db.select({ id: segments.id }).from(segments).where(eq(segments.id, segmentId)).limit(1);
    if (!segment[0]) {
      throw Object.assign(new Error(`Segment ${segmentId} not found.`), { statusCode: 404 });
    }

    const filters = await deriveProspectorFilters({ personaId, subPersonaId, userEmail, orgId: ctx?.orgId });
    const { records } = await searchProspectorContacts({
      orgId: ctx?.orgId,
      titleKeyword: filters.titleKeyword ?? undefined,
      seniority: filters.seniority ?? undefined,
      companyAllowList: companyAllowList ?? undefined,
      companyDenyList: companyDenyList ?? undefined,
      limit,
    });

    // Same pool of scorable personas score-contact.ts's action queries —
    // scoreContactAgainstPersonas itself picks the single best-fitting one
    // per contact.
    const personaRows = await db
      .select({ id: personas.id, name: personas.name, criteria: personas.criteria })
      .from(personas)
      .where(sql`${personas.criteria} IS NOT NULL`);

    const now = new Date().toISOString();
    let imported = 0;
    let scored = 0;

    for (const match of records) {
      const linkedinUrl = match.linkedInHandle ? `https://www.linkedin.com/${match.linkedInHandle}` : null;

      const existing = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.externalId, match.id), eq(contacts.source, "prospector")))
        .limit(1);

      let contactId: string;
      if (existing[0]) {
        contactId = existing[0].id;
        // Mirrors sync-hubspot.ts's update path: refresh the source-of-truth
        // fields but never touch `status` here — that's per-contact worked
        // state the XDR owns, not something a re-import should reset.
        await db
          .update(contacts)
          .set({
            name: match.fullName ?? "Unknown",
            title: match.title ?? null,
            company: match.companyName ?? null,
            email: null,
            linkedinUrl,
            syncedAt: now,
            updatedAt: now,
          })
          .where(eq(contacts.id, contactId));
      } else {
        contactId = nanoid();
        await db.insert(contacts).values({
          id: contactId,
          name: match.fullName ?? "Unknown",
          title: match.title ?? null,
          company: match.companyName ?? null,
          email: null, // Prospector has no email field — never invent or backfill one.
          linkedinUrl,
          source: "prospector",
          externalId: match.id,
          status: "active",
          syncedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
      imported++;

      const score = await scoreContactAgainstPersonas({
        contact: { name: match.fullName ?? "Unknown", title: match.title ?? null, company: match.companyName ?? null },
        personas: personaRows,
        userEmail,
        orgId: ctx?.orgId,
      });
      await db
        .update(contacts)
        .set({
          personaId: score.personaId,
          personaMatchScore: score.personaMatchScore,
          companyFitScore: score.companyFitScore,
          scoreReasoning: score.reasoning,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(contacts.id, contactId));
      scored++;

      const existingLink = await db
        .select({ id: segmentContacts.id })
        .from(segmentContacts)
        .where(and(eq(segmentContacts.segmentId, segmentId), eq(segmentContacts.contactId, contactId)))
        .limit(1);
      if (!existingLink[0]) {
        await db.insert(segmentContacts).values({ id: nanoid(), segmentId, contactId });
      }
    }

    await logAnalyticsEvent(userEmail, "sync_run", { source: "prospector", status: "success", recordsPulled: records.length });

    return { imported, scored, segmentId };
  },
});
