import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import type { DraftInput, LintResult } from "../server/core/drafting/index.js";
import { lintForEngagement } from "../server/lib/draft-lint.js";
import { sendKey } from "../server/lib/first-touch-send.js";
import { canEditHandbook } from "../server/lib/handbook-service.js";
import { newId, now, repo } from "../server/lib/pa-context.js";

// States where a first touch can still be written (save-draft's set).
const DRAFTABLE = new Set(["awaiting_first_touch", "routed", "attached"]);

export default defineAction({
  description:
    "People only (D100). Save a person's edit of the current first-touch draft as a new version. It is checked against the same message rules as the agent's draft (except the checks against the agent's own rubric) and is never sent: the owner still clicks Approve and send.",
  schema: z.object({
    engagementId: z.string().min(1),
    draftId: z.string().min(1),
    subject: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(4000),
  }),
  agentTool: false,
  mcpTool: false,
  audit: {
    target: (args: { engagementId: string }) => ({
      type: "pa-engagement",
      id: args.engagementId,
    }),
    summary: (args: { engagementId: string }) =>
      `Edited the first-touch draft on ${args.engagementId}`,
  },
  run: async (args, ctx) => {
    if (ctx?.caller === "tool")
      fail("Only a person can edit a draft here.", { statusCode: 403 });
    const email = ctx?.userEmail?.toLowerCase();
    if (!email) fail("Sign in first", { statusCode: 401 });
    if (!(await canEditHandbook(ctx)))
      fail("Editing a draft needs a PA role or app owner access.", {
        statusCode: 403,
      });
    const repository = repo();
    const engagement = await repository.getEngagement(args.engagementId);
    if (!engagement) fail("Lead not found", { statusCode: 404 });
    if (engagement.firstTouchAt || !DRAFTABLE.has(engagement.state))
      fail("This lead was already contacted or moved on.", {
        statusCode: 409,
        errorCode: "not_draftable",
      });
    const sent = await repository.getOutboxByKey(sendKey(engagement.id));
    if (sent && sent.status !== "failed")
      fail("This lead's first touch already went out.", { statusCode: 409 });
    const drafts = await repository.listDrafts(engagement.id);
    const previous = drafts[drafts.length - 1];
    if (!previous || previous.id !== args.draftId)
      fail("A newer draft replaced this one. Reload the lead first.", {
        statusCode: 409,
        errorCode: "stale_draft",
      });
    const prior = (previous.lint ?? {}) as Partial<LintResult>;
    const input = {
      subject: args.subject,
      body: args.body,
      approach: prior.approach,
      cta: previous.cta,
      language: previous.language,
      used_entry_ids: previous.usedEntryIds,
      rubric: prior.rubric ?? { trigger: "", connection: "", ask: "" },
      question_handling: prior.questionHandling,
      reasoning: prior.reasoning,
    } as DraftInput;
    const lint = await lintForEngagement(repository, engagement, input, {
      human: true,
    });
    const at = now().toISOString();
    const draftId = newId();
    await repository.transaction(async (tx) => {
      await tx.insertDraft({
        id: draftId,
        engagementId: engagement.id,
        submissionId: previous.submissionId,
        subject: args.subject,
        body: args.body,
        cta: previous.cta,
        language: previous.language,
        status: lint.ok ? "proposed" : "needs_edit",
        usedEntryIds: previous.usedEntryIds,
        lint: JSON.parse(JSON.stringify({ ...lint, editedBy: email })),
        source: "user",
        receiptId: previous.receiptId,
        version: previous.version + 1,
        createdAt: at,
        updatedAt: at,
      });
      await tx.appendEvent({
        id: newId(),
        engagementId: engagement.id,
        correlationId: engagement.id,
        type: "draft.edited",
        actor: `user:${email}`,
        payload: {
          draft_id: draftId,
          replaces: previous.id,
          lint_ok: lint.ok,
          problems: lint.problems.length,
        },
        receiptId: null,
        occurredAt: at,
      });
    });
    return {
      draftId,
      status: lint.ok ? "proposed" : "needs_edit",
      problems: lint.problems,
      sent: false,
    };
  },
});
