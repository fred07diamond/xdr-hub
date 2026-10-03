import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { canEditHandbook } from "../server/lib/handbook-service.js";
import { wakeInboundAgent } from "../server/lib/live-pipeline.js";
import { newId, now, repo } from "../server/lib/pa-context.js";

export default defineAction({
  description:
    "People only (D106). Have the agent write a follow-up again under the current rules: it goes back to the agent's queue and the agent is woken. Not for a template email or one already sent.",
  schema: z.object({ followUpId: z.string().min(1) }),
  agentTool: false,
  mcpTool: false,
  audit: {
    target: (args: { followUpId: string }) => ({
      type: "pa-follow-up",
      id: args.followUpId,
    }),
    summary: (args: { followUpId: string }) =>
      `Asked the agent to rewrite follow-up ${args.followUpId}`,
  },
  run: async (args, ctx) => {
    const email = ctx?.userEmail?.toLowerCase();
    if (!email || ctx?.caller === "tool")
      fail("Only a person can do this.", { statusCode: 403 });
    if (!(await canEditHandbook(ctx)))
      fail("This needs a PA role or app owner access.", { statusCode: 403 });
    const repository = repo();
    const row = await repository.getFollowUp(args.followUpId);
    if (!row) fail("Follow-up not found", { statusCode: 404 });
    if (row.status !== "drafted" && row.status !== "needs_edit")
      fail(
        "Only an agent-written follow-up waiting for review can be rewritten.",
        {
          statusCode: 409,
        },
      );
    const at = now().toISOString();
    // Back to the agent: due within 18 hours puts it in list-agent-work.
    await repository.updateFollowUp(
      row.id,
      {
        status: "scheduled",
        body: null,
        lint: null,
        editedBy: null,
        dueAt: row.dueAt < at ? at : row.dueAt,
        updatedAt: at,
      },
      row.version,
    );
    await repository.appendEvent({
      id: newId(),
      engagementId: row.engagementId,
      correlationId: row.engagementId,
      type: "follow_up.rewrite_requested",
      actor: `user:${email}`,
      payload: { follow_up_id: row.id, step: row.stepIndex },
      receiptId: null,
      occurredAt: at,
    });
    const agent = await wakeInboundAgent({
      userEmail: email,
      orgId: ctx?.orgId,
    });
    return { requested: true, agent };
  },
});
