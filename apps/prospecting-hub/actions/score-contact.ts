import { defineAction } from "@agent-native/core";
import { eq, sql } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { contacts, personas } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";
import { scoreContactAgainstPersonas } from "../server/helpers/score-contact.js";

export default defineAction({
  description: "Score one contact against all personas with synced criteria, writing personaId/personaMatchScore/companyFitScore/engagementScore/overallScore/scoreReasoning back onto the contact.",
  schema: z.object({ contactId: z.string().min(1) }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ contactId }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    const contactRows = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
    const contact = contactRows[0];
    if (!contact) {
      throw Object.assign(new Error(`Contact ${contactId} not found.`), { statusCode: 404 });
    }

    const personaRows = await db
      .select({ id: personas.id, name: personas.name, criteria: personas.criteria })
      .from(personas)
      .where(sql`${personas.criteria} IS NOT NULL`);

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
        updatedAt: new Date().toISOString(),
      })
      .where(eq(contacts.id, contactId));

    return { contactId, ...score };
  },
});
