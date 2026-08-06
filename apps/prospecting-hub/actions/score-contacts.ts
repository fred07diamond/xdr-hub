import { defineAction } from "@agent-native/core";
import { and, eq, isNull, sql } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { contacts, personas } from "../server/db/schema.js";
import { mapWithConcurrency } from "../server/helpers/concurrency.js";
import { requireRole } from "../server/helpers/require-role.js";
import { scoreContactAgainstPersonas } from "../server/helpers/score-contact.js";

// Same order-of-magnitude cap as the sync actions' page sizes.
const MAX_CONTACTS_PER_RUN = 50;
// Bounded concurrency, not strictly sequential — see concurrency.ts for why:
// a single CommonRoom lookup alone can take ~16-20s during a real CommonRoom
// slowdown, and this loop used to run one contact at a time, which made
// rescore-contacts.ts's identical pattern blow past the hosting platform's
// 75s function timeout in production.
const SCORING_CONCURRENCY = 8;

export default defineAction({
  description: "Score all not-yet-scored active contacts (up to a cap) against personas with synced criteria. Re-run to pick up more.",
  schema: z.object({
    limit: z.number().int().min(1).max(MAX_CONTACTS_PER_RUN).default(20),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ limit }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    const personaRows = await db
      .select({ id: personas.id, name: personas.name, criteria: personas.criteria })
      .from(personas)
      .where(sql`${personas.criteria} IS NOT NULL`);

    if (personaRows.length === 0) {
      return { scored: 0, error: "No personas with synced criteria yet — upload a persona doc on the Personas tab first." };
    }

    const unscored = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.status, "active"), isNull(contacts.personaMatchScore)))
      .limit(limit);

    const now = () => new Date().toISOString();

    const results = await mapWithConcurrency(unscored, SCORING_CONCURRENCY, async (contact) => {
      try {
        const score = await scoreContactAgainstPersonas({
          contact: {
            name: contact.name,
            title: contact.title,
            company: contact.company,
            country: contact.country,
            employees: contact.employees,
            hubspotQlScore: contact.hubspotQlScore,
            hubspotBreezeFitScore: contact.hubspotBreezeFitScore,
            apolloCompanyFitScore: contact.apolloCompanyFitScore,
            apolloIntentScore: contact.apolloIntentScore,
            apolloTitle: contact.apolloTitle,
            apolloSeniority: contact.apolloSeniority,
          },
          personas: personaRows,
          userEmail: ctx!.userEmail!,
          orgId: ctx?.orgId,
        });
        await db
          .update(contacts)
          .set({
            personaId: score.personaId,
            personaMatchScore: score.personaMatchScore,
            companyFitScore: score.companyFitScore,
            engagementScore: score.engagementScore,
            hubspotQlScore: score.hubspotQlScore,
            commonRoomIntentScore: score.commonRoomIntentScore,
            commonRoomCompanyFitScore: score.commonRoomCompanyFitScore,
            apolloCompanyFitScore: score.apolloCompanyFitScore,
            apolloIntentScore: score.apolloIntentScore,
            overallScore: score.overallScore,
            scoreReasoning: score.reasoning,
            updatedAt: now(),
          })
          .where(eq(contacts.id, contact.id));
        return { ok: true as const };
      } catch (err) {
        return { ok: false as const, error: `${contact.id}: ${err instanceof Error ? err.message : String(err)}` };
      }
    });

    const scored = results.filter((r) => r.ok).length;
    const errors = results.filter((r): r is { ok: false; error: string } => !r.ok).map((r) => r.error);

    return { scored, attempted: unscored.length, errors };
  },
});
