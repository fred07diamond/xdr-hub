import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { canEditHandbook } from "../server/lib/handbook-service.js";
import { wakeInboundAgent } from "../server/lib/live-pipeline.js";
import { newId, now, repo } from "../server/lib/pa-context.js";

export const REDRAFT_EVENT = "draft.rewrite_requested";

export default defineAction({
  description:
    "People only. Rewrite just the drafted reply on one lead under the current playbook (D87): the lead goes to the front of the agent's queue and the agent is woken now. Nothing else about the lead is re-run, nothing is sent, and HubSpot is not changed.",
  schema: z.object({
    engagementId: z.string().min(1),
    note: z
      .string()
      .trim()
      .max(500)
      .nullable()
      .optional()
      .describe("What to change, for the agent"),
  }),
  agentTool: false,
  audit: {
    target: (args: { engagementId: string }) => ({
      type: "pa-engagement",
      id: args.engagementId,
    }),
    summary: (args: { engagementId: string }) =>
      `Asked to rewrite the reply on ${args.engagementId}`,
  },
  run: async (args, ctx) => {
    const email = ctx?.userEmail?.toLowerCase();
    if (!email) fail("Sign in first", { statusCode: 401 });
    if (!(await canEditHandbook(ctx)))
      fail("Rewriting a reply needs a PA role or app owner access.", {
        statusCode: 403,
      });
    const repository = repo();
    const engagement = await repository.getEngagement(args.engagementId);
    if (!engagement) fail("Lead not found", { statusCode: 404 });
    await repository.appendEvent({
      id: newId(),
      engagementId: engagement.id,
      correlationId: engagement.id,
      type: REDRAFT_EVENT,
      actor: `user:${email}`,
      payload: { note: args.note ?? null },
      receiptId: null,
      occurredAt: now().toISOString(),
    });
    const agent = await wakeInboundAgent({
      userEmail: email,
      orgId: ctx?.orgId,
    });
    return { requested: true, agent, sent: false };
  },
});
