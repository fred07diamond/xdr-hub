import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { inboundLeads } from "../server/db/schema.js";
import { fetchIntroCallResearch } from "../server/helpers/intro-call-hubspot.js";
import { scoreIntroCallLead } from "../server/helpers/intro-call-score.js";
import { generateCheckpointOne } from "../server/helpers/intro-call-generate.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "Run the Intro Call Assistant's Checkpoint 1 for one inbound lead: pull HubSpot research, run the deterministic scoring engine, and generate the TLDR, HubSpot summary, scorecard, and recommendation. This is what the 'Action lead' button calls.",
  schema: z.object({
    leadId: z.string().min(1),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ leadId }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "admin"]);

    const db = getDb();
    const [lead] = await db.select().from(inboundLeads).where(eq(inboundLeads.id, leadId)).limit(1);
    if (!lead) {
      throw Object.assign(new Error("Lead not found"), { statusCode: 404 });
    }

    const research = await fetchIntroCallResearch(lead.hubspotContactId);
    const scorecard = scoreIntroCallLead(research);
    const checkpoint = await generateCheckpointOne(research, scorecard);

    const now = new Date().toISOString();
    await db
      .update(inboundLeads)
      .set({
        introTldr: checkpoint.tldr,
        introHubspotSummary: checkpoint.hubspotSummary,
        introScorecardText: checkpoint.scorecardText,
        introPainScore: checkpoint.painScore,
        introPainLabel: checkpoint.painLabel,
        introChampionScore: checkpoint.championScore,
        introChampionLabel: checkpoint.championLabel,
        introRecommendation: checkpoint.recommendation,
        introRecommendationRationale: checkpoint.recommendationRationale,
        introCheckpointGeneratedAt: now,
        // A fresh checkpoint invalidates any earlier decision/output/worksheet.
        introDecision: null,
        introOutputSubject: null,
        introOutputBody: null,
        introAeName: null,
        introAeEmail: null,
        introTimeWorks: null,
        introAltTime1: null,
        introAltTime2: null,
        introDecisionGeneratedAt: null,
        introWorksheet: null,
      })
      .where(eq(inboundLeads.id, leadId));

    return {
      leadId,
      product: scorecard.product,
      productNeedsConfirmation: scorecard.productNeedsConfirmation,
      ...checkpoint,
    };
  },
});
