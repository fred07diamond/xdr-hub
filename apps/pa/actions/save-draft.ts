import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  draftInputSchema,
  firstName,
  lintDraft,
} from "../server/core/drafting/index.js";
import { loadRelease } from "../server/core/playbook/store.js";
import { newId, now, repo } from "../server/lib/pa-context.js";

// States where a first touch can still be written: a new lead waiting for it
// (with or without an owner yet), or an attached lead whose owner asked.
const DRAFTABLE = new Set(["awaiting_first_touch", "routed", "attached"]);

export default defineAction({
  description:
    "Save a first-touch draft for one engagement, following the first-touch-drafting skill. The draft is linted against the pinned playbook's message rules and saved as proposed (passes) or needs_edit (with the problems returned, so you can fix only those and save again). Never sends anything. Use [calendar link] where the owner's calendar link goes.",
  schema: draftInputSchema.extend({
    engagementId: z.string().min(1),
  }),
  http: false,
  mcpTool: false,
  audit: {
    target: (args: { engagementId: string }) => ({
      type: "pa-engagement",
      id: args.engagementId,
    }),
    summary: (args: { engagementId: string }) =>
      `Saved a first-touch draft for ${args.engagementId}`,
  },
  run: async (args, ctx) => {
    const repository = repo();
    const engagement = await repository.getEngagement(args.engagementId);
    if (!engagement) fail("Engagement not found", { statusCode: 404 });
    if (!DRAFTABLE.has(engagement.state)) {
      fail(
        `This lead is ${engagement.state.replace(/_/g, " ")}, so it gets no first-touch draft.`,
        { statusCode: 409, errorCode: "not_draftable" },
      );
    }
    const release = await loadRelease(repository, engagement.playbookReleaseId);
    if (!release) fail("The lead's playbook release is missing");
    const submissions = await repository.listSubmissionsForEngagement(
      engagement.id,
    );
    const submission = submissions[submissions.length - 1];
    const assessment = submission
      ? await repository.getAssessmentForSubmission(submission.id)
      : null;
    const owner = engagement.ownerUserId
      ? await repository.getProfile(engagement.ownerUserId)
      : null;
    const routeReceipt = submission
      ? await repository.findReceipt("route", submission.id)
      : null;
    const routedOwner = (
      routeReceipt?.ruleResults.routing as
        | { owner?: { displayName?: string | null } | null }
        | undefined
    )?.owner;
    const { engagementId: _engagement, ...input } = args;
    const lint = lintDraft({
      draft: input,
      release,
      explicitQuestion: assessment?.explicitQuestion ?? null,
      ownerFirstName: firstName(
        owner?.displayName ?? routedOwner?.displayName ?? null,
      ),
    });
    const at = now().toISOString();
    const receiptId = newId();
    const draftId = newId();
    const actor =
      ctx?.caller === "tool"
        ? "agent:draft"
        : `user:${ctx?.userEmail ?? "unknown"}`;
    const previous = await repository.listDrafts(engagement.id);
    await repository.transaction(async (tx) => {
      await tx.insertReceipt({
        id: receiptId,
        kind: "draft",
        engagementId: engagement.id,
        submissionId: submission?.id ?? null,
        playbookReleaseId: engagement.playbookReleaseId,
        entryVersions: release.entries
          .filter((entry) => input.used_entry_ids.includes(entry.id))
          .map((entry) => ({ id: entry.id, version: entry.version })),
        ruleResults: JSON.parse(
          JSON.stringify({ needed: true, source: "agent", lint }),
        ),
        inputs: {
          submission_id: submission?.id ?? null,
          owner: owner?.email ?? null,
          replaces: previous[previous.length - 1]?.id ?? null,
        },
        agentRunId: ctx?.runId ?? null,
        toolCalls:
          ctx?.caller === "tool"
            ? [{ tool: "save-draft", run_id: ctx.runId ?? null }]
            : null,
        model: null,
        createdAt: at,
      });
      await tx.insertDraft({
        id: draftId,
        engagementId: engagement.id,
        submissionId: submission?.id ?? null,
        subject: input.subject,
        body: input.body,
        cta: input.cta,
        language: input.language,
        status: lint.ok ? "proposed" : "needs_edit",
        usedEntryIds: input.used_entry_ids,
        lint: JSON.parse(JSON.stringify(lint)),
        source: "agent",
        receiptId,
        version: previous.length + 1,
        createdAt: at,
        updatedAt: at,
      });
      await tx.appendEvent({
        id: newId(),
        engagementId: engagement.id,
        correlationId: submission?.inboxId ?? engagement.id,
        type: "draft.proposed",
        actor,
        payload: {
          draft_id: draftId,
          lint_ok: lint.ok,
          problems: lint.problems.length,
          source: "agent",
        },
        receiptId,
        occurredAt: at,
      });
    });
    return {
      draftId,
      status: lint.ok ? "proposed" : "needs_edit",
      lint,
      sent: false,
    };
  },
});
