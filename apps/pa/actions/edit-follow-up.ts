import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { lintFollowUp } from "../server/core/drafting/follow-up.js";
import { earlierEmails, routeLinkOf } from "../server/lib/follow-ups.js";
import { canEditHandbook } from "../server/lib/handbook-service.js";
import { activeRelease, newId, now, repo } from "../server/lib/pa-context.js";

export default defineAction({
  description:
    "People only (D101). Save a person's edit of a follow-up. Checked against the follow-up rules; the agent will not rewrite it afterwards. Never sends.",
  schema: z.object({
    followUpId: z.string().min(1),
    body: z.string().trim().min(1).max(3000),
    /** A new-email step's subject (D104). */
    subject: z.string().trim().max(120).nullable().optional(),
  }),
  agentTool: false,
  mcpTool: false,
  audit: {
    target: (args: { followUpId: string }) => ({
      type: "pa-follow-up",
      id: args.followUpId,
    }),
    summary: (args: { followUpId: string }) =>
      `Edited follow-up ${args.followUpId}`,
  },
  run: async (args, ctx) => {
    if (ctx?.caller === "tool")
      fail("Only a person can edit here.", { statusCode: 403 });
    const email = ctx?.userEmail?.toLowerCase();
    if (!email) fail("Sign in first", { statusCode: 401 });
    if (!(await canEditHandbook(ctx)))
      fail("Editing needs a PA role or app owner access.", { statusCode: 403 });
    const repository = repo();
    const row = await repository.getFollowUp(args.followUpId);
    if (!row) fail("Follow-up not found", { statusCode: 404 });
    if (row.status === "sent" || row.status === "stopped")
      fail(`This follow-up is ${row.status}.`, { statusCode: 409 });
    const lint = lintFollowUp({
      body: args.body,
      release: await activeRelease(repository),
      earlier: await earlierEmails(repository, row),
      link: await routeLinkOf(repository, row.engagementId),
      newThread: row.thread === "new",
      subject: row.thread === "new" ? (args.subject ?? row.subject) : null,
    });
    const prior = (row.lint ?? {}) as Record<string, unknown>;
    const at = now().toISOString();
    await repository.updateFollowUp(
      row.id,
      {
        // An approved template email stays approved when the edit passes (D105).
        status: lint.ok
          ? row.status === "approved"
            ? "approved"
            : "drafted"
          : "needs_edit",
        body: args.body,
        ...(row.thread === "new" && args.subject !== undefined
          ? { subject: args.subject }
          : {}),
        lint: { ...lint, reasoning: prior.reasoning ?? null, source: "user" },
        editedBy: email,
        updatedAt: at,
      },
      row.version,
    );
    await repository.appendEvent({
      id: newId(),
      engagementId: row.engagementId,
      correlationId: row.engagementId,
      type: "follow_up.edited",
      actor: `user:${email}`,
      payload: { follow_up_id: row.id, step: row.stepIndex, lint_ok: lint.ok },
      receiptId: null,
      occurredAt: at,
    });
    return {
      status: lint.ok ? "drafted" : "needs_edit",
      problems: lint.problems,
    };
  },
});
