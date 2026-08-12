import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { inboundLeads } from "../server/db/schema.js";
import { fetchIntroCallResearch } from "../server/helpers/intro-call-hubspot.js";
import { scoreIntroCallLead } from "../server/helpers/intro-call-score.js";
import {
  generateAeIntroEmail,
  generateQualifyOutEmail,
  generateTakeCallEmail,
  type IntroCallCheckpoint,
} from "../server/helpers/intro-call-generate.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "Record the xDR's decision for one inbound lead (take the call / pivot to AE / disqualify) and generate the matching email. Requires run-intro-call-checkpoint to have run first.",
  schema: z.object({
    leadId: z.string().min(1),
    decision: z.enum(["take_call", "pivot_ae", "disqualify"]),
    aeName: z.string().optional(),
    aeEmail: z.string().optional(),
    timeWorks: z.boolean().optional(),
    altTime1: z.string().optional(),
    altTime2: z.string().optional(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ leadId, decision, aeName, aeEmail, timeWorks, altTime1, altTime2 }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "admin"]);

    const db = getDb();
    const [lead] = await db.select().from(inboundLeads).where(eq(inboundLeads.id, leadId)).limit(1);
    if (!lead) {
      throw Object.assign(new Error("Lead not found"), { statusCode: 404 });
    }
    if (!lead.introCheckpointGeneratedAt) {
      throw Object.assign(new Error("Run the checkpoint (Action lead) before deciding."), { statusCode: 400 });
    }

    const checkpoint: IntroCallCheckpoint = {
      tldr: lead.introTldr ?? "",
      hubspotSummary: lead.introHubspotSummary ?? "",
      scorecardText: lead.introScorecardText ?? "",
      painScore: lead.introPainScore ?? 0,
      painLabel: (lead.introPainLabel as IntroCallCheckpoint["painLabel"]) ?? "Unknown",
      championScore: lead.introChampionScore ?? 0,
      championLabel: (lead.introChampionLabel as IntroCallCheckpoint["championLabel"]) ?? "Unknown",
      recommendation: (lead.introRecommendation as IntroCallCheckpoint["recommendation"]) ?? "take_call",
      recommendationRationale: lead.introRecommendationRationale ?? "",
    };

    const research = await fetchIntroCallResearch(lead.hubspotContactId);
    const scorecard = scoreIntroCallLead(research);

    let subject: string;
    let body: string;

    if (decision === "take_call") {
      const email = await generateTakeCallEmail(research, scorecard, checkpoint);
      subject = email.subject;
      body = email.body;
    } else if (decision === "pivot_ae") {
      if (!aeName) {
        throw Object.assign(new Error("aeName is required to pivot to an AE."), { statusCode: 400 });
      }
      const resolvedTimeWorks = timeWorks ?? true;
      if (!resolvedTimeWorks && (!altTime1 || !altTime2)) {
        throw Object.assign(new Error("Two alternate times are required when the booked time doesn't work."), {
          statusCode: 400,
        });
      }
      const email = await generateAeIntroEmail(
        research,
        scorecard,
        checkpoint,
        { name: aeName, email: aeEmail ?? null },
        resolvedTimeWorks,
        resolvedTimeWorks ? null : [altTime1!, altTime2!],
      );
      subject = email.subject;
      body = email.body;
    } else {
      const email = await generateQualifyOutEmail(research, scorecard, checkpoint);
      subject = email.subject;
      body = email.body;
    }

    const now = new Date().toISOString();
    await db
      .update(inboundLeads)
      .set({
        introDecision: decision,
        introOutputSubject: subject,
        introOutputBody: body,
        introAeName: decision === "pivot_ae" ? aeName ?? null : null,
        introAeEmail: decision === "pivot_ae" ? aeEmail ?? null : null,
        introTimeWorks: decision === "pivot_ae" ? ((timeWorks ?? true) ? 1 : 0) : null,
        introAltTime1: decision === "pivot_ae" && timeWorks === false ? altTime1 ?? null : null,
        introAltTime2: decision === "pivot_ae" && timeWorks === false ? altTime2 ?? null : null,
        introDecisionGeneratedAt: now,
        introWorksheet: null,
      })
      .where(eq(inboundLeads.id, leadId));

    return { leadId, decision, subject, body };
  },
});
