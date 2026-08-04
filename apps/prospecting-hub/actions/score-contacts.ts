import { defineAction } from "@agent-native/core";
import { and, eq, isNull, sql } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { contacts, personas } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";
import { scoreContactAgainstPersonas } from "../server/helpers/score-contact.js";

// Sequential, not parallel — completeText() calls should stay easy to reason
// about and rate-limit-friendly for v1. Same order-of-magnitude cap as the
// sync actions' page sizes.
const MAX_CONTACTS_PER_RUN = 50;

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

    let scored = 0;
    const errors: string[] = [];
    const now = () => new Date().toISOString();

    for (const contact of unscored) {
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
        scored++;
      } catch (err) {
        errors.push(`${contact.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { scored, attempted: unscored.length, errors };
  },
});
