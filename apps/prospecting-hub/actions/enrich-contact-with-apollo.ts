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
import type { ApolloOrganization, ApolloPersonMatch } from "../server/helpers/apollo-client.js";

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

    // Person Match and Organization Enrich are independent Apollo endpoints
    // with independently-scoped API-key permissions (live-confirmed: a key
    // can be authorized for one and rejected with a 403 on the other) — each
    // is wrapped separately so a scope/permission problem on one doesn't
    // block whichever data the other still gets, same "partial signal beats
    // no signal, never hard-fail the whole operation" discipline as
    // lookupCommonRoomSignals/lookupHubSpotContactDetail elsewhere in this
    // app. Failures are collected into `warnings` and returned to the caller
    // instead of silently swallowed, since an authorization error (misconfigured
    // key scope) needs to be visibly different from a normal "no match found"
    // — the drawer surfaces these so an XDR knows to go fix the Apollo key
    // rather than assume Apollo simply has no data on this person.
    const warnings: string[] = [];

    let person: ApolloPersonMatch | null = null;
    try {
      person = await matchApolloPerson({
        name: contact.name,
        companyName: contact.company,
        email: contact.email,
      });
    } catch (err) {
      warnings.push(`Person lookup: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Prefer the domain the person match's own nested organization returned
    // (a stronger match signal than company name alone) over falling back to
    // a name-only organization lookup.
    let organization: ApolloOrganization | null = null;
    try {
      organization = await enrichApolloOrganization({
        companyName: contact.company,
        domain: person?.organization?.primary_domain ?? null,
      });
    } catch (err) {
      warnings.push(`Organization lookup: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Both endpoints failed outright (not just "no match") — most likely an
    // invalid/unconfigured key entirely, not a per-endpoint scope gap. Surface
    // this as a real, actionable error (statusCode tagged so it reaches the
    // client as written, not sanitized to a generic 500 — see sync-hubspot.ts's
    // own precedent) rather than silently "succeeding" with nothing enriched.
    if (warnings.length === 2) {
      throw Object.assign(new Error(`Apollo enrichment failed: ${warnings.join("; ")}`), { statusCode: 502 });
    }

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

    return { contactId, apolloEnrichedAt: now, warnings, ...score };
  },
});
