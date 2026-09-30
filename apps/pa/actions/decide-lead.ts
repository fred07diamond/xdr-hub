import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  CUSTOMER_REDIRECT,
  decide,
  DecisionError,
  MEETING_CHOICES,
  STANDARD_CHOICES,
} from "../server/core/decisions/index.js";
import { decisionDeps } from "../server/lib/decisions.js";
import { canEditHandbook } from "../server/lib/handbook-service.js";

export default defineAction({
  description:
    "People only. The rep's decision on a lead (workflow 2b): accept and sequence, decline and recycle, or research more; for a booked meeting, take it, disqualify, bring in an AE, or route elsewhere; or redirect an existing customer to their AE and CSM. Changes the lead in PA only; nothing is written to HubSpot or sent.",
  schema: z.object({
    engagementId: z.string().min(1),
    choice: z.enum([
      ...STANDARD_CHOICES,
      ...MEETING_CHOICES,
      CUSTOMER_REDIRECT,
    ]),
    note: z.string().max(1000).nullable().optional(),
  }),
  agentTool: false,
  audit: {
    target: (args: { engagementId: string }) => ({
      type: "pa-engagement",
      id: args.engagementId,
    }),
    summary: (args: { choice: string; engagementId: string }) =>
      `Decided ${args.choice} on ${args.engagementId}`,
  },
  run: async (args, ctx) => {
    const email = ctx?.userEmail?.toLowerCase();
    if (!email) fail("Sign in to decide", { statusCode: 401 });
    if (!(await canEditHandbook(ctx)))
      fail(
        "Deciding on leads needs a PA role (PA team or RevOps) or app owner access.",
        { statusCode: 403 },
      );
    try {
      const decision = await decide(await decisionDeps(), {
        engagementId: args.engagementId,
        choice: args.choice,
        note: args.note?.trim() || null,
        actor: `user:${email}`,
      });
      return { decision, crmWritten: false, sent: false };
    } catch (error) {
      if (error instanceof DecisionError)
        fail(error.message, { statusCode: error.statusCode });
      throw error;
    }
  },
});
