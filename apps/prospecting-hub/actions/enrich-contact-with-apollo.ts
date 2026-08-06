import { defineAction } from "@agent-native/core";
import { eq, sql } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { contacts, personas } from "../server/db/schema.js";
import {
  enrichApolloOrganization,
  extractApolloIntentScore,
  matchApolloPerson,
} from "../server/helpers/apollo-client.js";
import { computeDeterministicCompanyFit } from "../server/helpers/company-fit.js";
import { requireRole } from "../server/helpers/require-role.js";
import { scoreContactAgainstPersonas } from "../server/helpers/score-contact.js";

export default defineAction({
  description:
    "Enrich one contact with Apollo.io person + organization data (title/seniority/email status, industry/headcount/funding), compute an independent Apollo Company Fit signal, and immediately rescore the contact so Overall Score reflects it. On-demand only — never called automatically during sync or the sourcing-rule pipeline.",
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

    const person = await matchApolloPerson({
      name: contact.name,
      companyName: contact.company,
      email: contact.email,
    });

    // Prefer the domain the person match's own nested organization returned
    // (a stronger match signal than company name alone) over falling back to
    // a name-only organization lookup.
    const organization = await enrichApolloOrganization({
      companyName: contact.company,
      domain: person?.organization?.primary_domain ?? null,
    });

    const apolloCompanyFitScore = computeDeterministicCompanyFit({
      country: organization?.country,
      employees: organization?.estimated_num_employees,
    });
    const apolloIntentScore = extractApolloIntentScore(organization);

    const enrichmentJson = JSON.stringify({
      employmentHistory: person?.employment_history ?? null,
      technologyNames: organization?.technology_names ?? null,
      fundingEvents: organization?.funding_events ?? null,
      linkedinUrl: person?.linkedin_url ?? organization?.linkedin_url ?? null,
    });

    const now = new Date().toISOString();

    await db
      .update(contacts)
      .set({
        apolloCompanyFitScore,
        apolloIntentScore,
        apolloSeniority: person?.seniority ?? null,
        apolloTitle: person?.title ?? null,
        apolloEmailStatus: person?.email_status ?? null,
        apolloIndustry: organization?.industry ?? null,
        apolloEmployeeCount: organization?.estimated_num_employees ?? null,
        apolloFundingStage: organization?.latest_funding_stage ?? null,
        apolloTotalFunding: organization?.total_funding ?? null,
        apolloEnrichmentJson: enrichmentJson,
        apolloEnrichedAt: now,
        updatedAt: now,
      })
      .where(eq(contacts.id, contactId));

    // Rescore immediately so Overall Score reflects the new Apollo signals
    // right away — same pattern as score-contact.ts, reading the columns
    // just written above back in as pass-through inputs.
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
        apolloCompanyFitScore,
        apolloIntentScore,
        apolloTitle: person?.title ?? null,
        apolloSeniority: person?.seniority ?? null,
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
        updatedAt: new Date().toISOString(),
      })
      .where(eq(contacts.id, contactId));

    return { contactId, apolloEnrichedAt: now, ...score };
  },
});
