import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { leadBriefSchema } from "../server/core/brief/index.js";
import { newId, now, repo } from "../server/lib/pa-context.js";

export default defineAction({
  description:
    "Save the lead brief for one engagement before drafting (first-touch-drafting skill): persona, deal role, use case, the V2 read, the five Stage 1 gates each met, gap, or unknown with evidence and the next move, enterprise signals, agency routing, gaps and risks, and the next step. Only facts from the form, HubSpot, and the handbook; unknown stays unknown. Saved in PA only, never written to HubSpot.",
  schema: leadBriefSchema.extend({ engagementId: z.string().min(1) }),
  http: false,
  mcpTool: false,
  audit: {
    target: (args: { engagementId: string }) => ({
      type: "pa-engagement",
      id: args.engagementId,
    }),
    summary: (args: { engagementId: string }) =>
      `Saved the lead brief for ${args.engagementId}`,
  },
  run: async (args, ctx) => {
    if (!ctx?.userEmail) fail("Sign in first", { statusCode: 401 });
    const repository = repo();
    const engagement = await repository.getEngagement(args.engagementId);
    if (!engagement) fail("Engagement not found", { statusCode: 404 });
    const { engagementId, ...brief } = args;
    const id = newId();
    const at = now().toISOString();
    await repository.insertLeadBrief({
      id,
      engagementId,
      brief: JSON.parse(JSON.stringify(brief)),
      createdBy:
        ctx.caller === "tool" ? "agent:lead-brief" : `user:${ctx.userEmail}`,
      createdAt: at,
    });
    await repository.appendEvent({
      id: newId(),
      engagementId,
      correlationId: engagementId,
      type: "brief.saved",
      actor:
        ctx.caller === "tool" ? "agent:lead-brief" : `user:${ctx.userEmail}`,
      payload: {
        gates_met: brief.gates.filter((gate) => gate.status === "met").length,
        persona: brief.persona,
      },
      receiptId: null,
      occurredAt: at,
    });
    return { briefId: id, crmWritten: false };
  },
});
