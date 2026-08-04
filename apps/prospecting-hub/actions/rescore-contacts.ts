import { defineAction } from "@agent-native/core";
import { and, eq, inArray, sql } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { contacts, personas } from "../server/db/schema.js";
import { mapWithConcurrency } from "../server/helpers/concurrency.js";
import { requireRole } from "../server/helpers/require-role.js";
import { scoreContactAgainstPersonas } from "../server/helpers/score-contact.js";

// Distinct from score-contacts.ts: that action only picks up NEVER-scored
// contacts (personaMatchScore IS NULL) and is meant for onboarding new
// contacts. This action re-scores contacts regardless of their current score
// state — for refreshing stale scores after personas/ICPs change, or after a
// bug in an older code path left some score columns unpopulated (e.g.
// import-prospects-to-segment.ts predates engagementScore/overallScore).
const MAX_CONTACTS_PER_RUN = 200;
// Contacts are scored concurrently (mapWithConcurrency), not one at a time —
// see concurrency.ts for the live-confirmed incident that made this
// necessary (a single CommonRoom lookup alone can take ~16-20s). Capped
// well below MAX_CONTACTS_PER_RUN so a large direct `contactIds` call can't
// fire off hundreds of simultaneous completeText()/CommonRoom calls.
const SCORING_CONCURRENCY = 8;

export default defineAction({
  description:
    "Re-score contacts (regardless of current score state) against personas with synced criteria. Pass contactIds to refresh a specific set (e.g. a UI selection); omit to refresh all active contacts, capped at 200 per run.",
  schema: z.object({
    contactIds: z.array(z.string().min(1)).min(1).max(MAX_CONTACTS_PER_RUN).nullish(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ contactIds }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    const personaRows = await db
      .select({ id: personas.id, name: personas.name, criteria: personas.criteria })
      .from(personas)
      .where(sql`${personas.criteria} IS NOT NULL`);

    if (personaRows.length === 0) {
      return { rescored: 0, error: "No personas with synced criteria yet — upload a persona doc on the Personas tab first." };
    }

    const targets = await db
      .select()
      .from(contacts)
      .where(
        contactIds
          ? inArray(contacts.id, contactIds)
          : and(eq(contacts.status, "active")),
      )
      .limit(MAX_CONTACTS_PER_RUN);

    const now = () => new Date().toISOString();

    const results = await mapWithConcurrency(targets, SCORING_CONCURRENCY, async (contact) => {
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

    const rescored = results.filter((r) => r.ok).length;
    const errors = results.filter((r): r is { ok: false; error: string } => !r.ok).map((r) => r.error);

    return { rescored, attempted: targets.length, errors };
  },
});
