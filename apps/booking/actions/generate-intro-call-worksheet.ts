import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { inboundLeads } from "../server/db/schema.js";
import { fetchIntroCallResearch } from "../server/helpers/intro-call-hubspot.js";
import { scoreIntroCallLead } from "../server/helpers/intro-call-score.js";
import { generateWorksheet, type IntroCallCheckpoint } from "../server/helpers/intro-call-generate.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "Generate the live-call worksheet for one inbound lead. Requires the xDR to have decided 'take the call' first.",
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
    if (lead.introDecision !== "take_call") {
      throw Object.assign(new Error("The worksheet is only for leads decided as 'take the call'."), {
        statusCode: 400,
      });
    }

    const checkpoint: IntroCallCheckpoint = {
      tldr: lead.introTldr ?? "",
      painScore: lead.introPainScore ?? 0,
      painLabel: (lead.introPainLabel as IntroCallCheckpoint["painLabel"]) ?? "Unknown",
      painRationale: lead.introPainRationale ?? "",
      championScore: lead.introChampionScore ?? 0,
      championLabel: (lead.introChampionLabel as IntroCallCheckpoint["championLabel"]) ?? "Unknown",
      championRationale: lead.introChampionRationale ?? "",
      recommendation: (lead.introRecommendation as IntroCallCheckpoint["recommendation"]) ?? "take_call",
      recommendationRationale: lead.introRecommendationRationale ?? "",
    };

    const research = await fetchIntroCallResearch(lead.hubspotContactId);
    const scorecard = scoreIntroCallLead(research);
    const worksheetMarkdown = await generateWorksheet(research, scorecard, checkpoint);

    await db.update(inboundLeads).set({ introWorksheet: worksheetMarkdown }).where(eq(inboundLeads.id, leadId));

    return { leadId, worksheetMarkdown };
  },
});
