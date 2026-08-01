import { defineAction } from "@agent-native/core";
import { and, eq, inArray, sql } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { contacts, personas } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";
import { scoreContactAgainstPersonas } from "../server/helpers/score-contact.js";

// Distinct from score-contacts.ts: that action only picks up NEVER-scored
// contacts (personaMatchScore IS NULL) and is meant for onboarding new
// contacts. This action re-scores contacts regardless of their current score
// state — for refreshing stale scores after personas/ICPs change, or after a
// bug in an older code path left some score columns unpopulated (e.g.
// import-prospects-to-segment.ts predates engagementScore/overallScore).
const MAX_CONTACTS_PER_RUN = 200;

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

    let rescored = 0;
    const errors: string[] = [];
    const now = () => new Date().toISOString();

    for (const contact of targets) {
      try {
        const score = await scoreContactAgainstPersonas({
          contact: {
            name: contact.name,
            title: contact.title,
            company: contact.company,
            country: contact.country,
            employees: contact.employees,
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
            overallScore: score.overallScore,
            scoreReasoning: score.reasoning,
            updatedAt: now(),
          })
          .where(eq(contacts.id, contact.id));
        rescored++;
      } catch (err) {
        errors.push(`${contact.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { rescored, attempted: targets.length, errors };
  },
});
