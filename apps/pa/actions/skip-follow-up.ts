import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { stopFollowUps } from "../server/lib/follow-ups.js";
import { canEditHandbook } from "../server/lib/handbook-service.js";
import { newId, now, repo } from "../server/lib/pa-context.js";

export default defineAction({
  description:
    "People only (D101). Skip one follow-up (the cadence goes on), or with all: true stop every remaining follow-up on the lead.",
  schema: z.object({
    followUpId: z.string().min(1),
    all: z.boolean().optional(),
  }),
  agentTool: false,
  mcpTool: false,
  audit: {
    target: (args: { followUpId: string }) => ({
      type: "pa-follow-up",
      id: args.followUpId,
    }),
    summary: (args: { followUpId: string; all?: boolean }) =>
      args.all
        ? `Stopped follow-ups from ${args.followUpId}`
        : `Skipped follow-up ${args.followUpId}`,
  },
  run: async (args, ctx) => {
    if (ctx?.caller === "tool")
      fail("Only a person can do this.", { statusCode: 403 });
    const email = ctx?.userEmail?.toLowerCase();
    if (!email) fail("Sign in first", { statusCode: 401 });
    if (!(await canEditHandbook(ctx)))
      fail("This needs a PA role or app owner access.", { statusCode: 403 });
    const repository = repo();
    const row = await repository.getFollowUp(args.followUpId);
    if (!row) fail("Follow-up not found", { statusCode: 404 });
    if (args.all) {
      const stopped = await stopFollowUps(
        repository,
        row.engagementId,
        `Stopped by ${email}`,
      );
      return { stopped };
    }
    if (row.status === "sent" || row.status === "stopped")
      fail(`This follow-up is ${row.status}.`, { statusCode: 409 });
    const at = now().toISOString();
    await repository.updateFollowUp(
      row.id,
      { status: "stopped", stopReason: `Skipped by ${email}`, updatedAt: at },
      row.version,
    );
    await repository.appendEvent({
      id: newId(),
      engagementId: row.engagementId,
      correlationId: row.engagementId,
      type: "follow_up.skipped",
      actor: `user:${email}`,
      payload: { follow_up_id: row.id, step: row.stepIndex },
      receiptId: null,
      occurredAt: at,
    });
    return { skipped: true };
  },
});
