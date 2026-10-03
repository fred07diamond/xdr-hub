import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { lintFollowUp } from "../server/core/drafting/follow-up.js";
import {
  earlierEmails,
  firstTouchOf,
  replySubject,
  routeLinkOf,
} from "../server/lib/follow-ups.js";
import { activeRelease, newId, now, repo } from "../server/lib/pa-context.js";

export default defineAction({
  description:
    "Save the follow-up email you wrote for one step of a lead's cadence (D101), after get-follow-up. It is checked against the follow-up rules and saved as drafted (passes) or needs_edit (the problems come back; fix only those and save again). Never sends anything; the owner sends it.",
  schema: z.object({
    followUpId: z.string().min(1),
    body: z.string().trim().min(1).max(3000),
    subject: z
      .string()
      .trim()
      .max(120)
      .nullable()
      .optional()
      .describe(
        'Only for a step with thread "new": the new email\'s subject. Leave out for a reply in the thread.',
      ),
    reasoning: z
      .string()
      .trim()
      .max(600)
      .describe("In plain words: what this follow-up adds and why"),
  }),
  http: false,
  mcpTool: false,
  audit: {
    target: (args: { followUpId: string }) => ({
      type: "pa-follow-up",
      id: args.followUpId,
    }),
    summary: (args: { followUpId: string }) =>
      `Saved follow-up ${args.followUpId}`,
  },
  run: async (args, ctx) => {
    const repository = repo();
    const row = await repository.getFollowUp(args.followUpId);
    if (!row) fail("Follow-up not found", { statusCode: 404 });
    if (row.status === "sent" || row.status === "stopped")
      fail(`This follow-up is ${row.status}; nothing to write.`, {
        statusCode: 409,
      });
    if (row.editedBy)
      fail("A person edited this follow-up; leave it as they wrote it.", {
        statusCode: 409,
      });
    const lint = lintFollowUp({
      body: args.body,
      release: await activeRelease(repository),
      earlier: await earlierEmails(repository, row),
      link: await routeLinkOf(repository, row.engagementId),
      newThread: row.thread === "new",
      subject: args.subject ?? null,
    });
    const first = await firstTouchOf(repository, row.engagementId);
    const at = now().toISOString();
    await repository.updateFollowUp(
      row.id,
      {
        status: lint.ok ? "drafted" : "needs_edit",
        subject:
          row.thread === "new"
            ? (args.subject ?? null)
            : replySubject(first.subject),
        body: args.body,
        lint: { ...lint, reasoning: args.reasoning, source: "agent" },
        updatedAt: at,
      },
      row.version,
    );
    await repository.appendEvent({
      id: newId(),
      engagementId: row.engagementId,
      correlationId: row.engagementId,
      type: "follow_up.drafted",
      actor:
        ctx?.caller === "tool"
          ? "agent:follow-up"
          : `user:${ctx?.userEmail ?? "unknown"}`,
      payload: { follow_up_id: row.id, step: row.stepIndex, lint_ok: lint.ok },
      receiptId: null,
      occurredAt: at,
    });
    return {
      status: lint.ok ? "drafted" : "needs_edit",
      problems: lint.problems,
      wordCount: lint.wordCount,
      sent: false,
    };
  },
});
