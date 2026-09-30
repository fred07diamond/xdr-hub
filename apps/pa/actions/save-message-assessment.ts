import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  assessmentInputSchema,
  validateAssessment,
} from "../server/core/assessment/index.js";
import { resumeAfterAgent } from "../server/lib/live-pipeline.js";
import {
  activeRelease,
  isPaAdmin,
  newId,
  now,
  repo,
} from "../server/lib/pa-context.js";

export default defineAction({
  description:
    "Agent only. Save the structured assessment of one inbound form message. Every evidence quote and the explicit question must be exact substrings of the message; validation errors name what to fix. Does not score, route, or draft.",
  schema: assessmentInputSchema.extend({
    engagementId: z.string().min(1),
    submissionId: z
      .string()
      .optional()
      .describe("Defaults to the latest submission"),
  }),
  http: false,
  mcpTool: false,
  toolCallable: false,
  // "Agent only" is enforced, not just described: until the M1 agent step
  // settles its own identity (D3), only workspace admins' runs may save.
  authorize: async (_args, ctx) => {
    if (!(await isPaAdmin(ctx?.userEmail ?? null))) {
      throw new Error(
        "Saving an assessment is limited to the pipeline's agent step and workspace admins.",
      );
    }
  },
  audit: {
    target: (args: { engagementId: string }) => ({
      type: "pa-engagement",
      id: args.engagementId,
    }),
    summary: (args: { engagementId: string; intent: string }) =>
      `Saved message assessment (${args.intent}) for ${args.engagementId}`,
  },
  run: async (args, ctx) => {
    const release = await activeRelease();
    const repository = repo();
    const engagement = await repository.getEngagement(args.engagementId);
    if (!engagement) fail("Engagement not found", { statusCode: 404 });
    const submissions = await repository.listSubmissionsForEngagement(
      engagement.id,
    );
    const submission = args.submissionId
      ? submissions.find((item) => item.id === args.submissionId)
      : submissions[submissions.length - 1];
    if (!submission)
      fail("Submission not found for this engagement", { statusCode: 404 });

    // One writer per submission (CONTEXT guideline 4): later reads and the
    // pre-check receipt always see the same assessment.
    if (await repository.getAssessmentForSubmission(submission.id)) {
      fail("This submission already has an assessment", {
        statusCode: 409,
        errorCode: "assessment_exists",
      });
    }
    const {
      engagementId: _engagement,
      submissionId: _submission,
      ...input
    } = args;
    const validation = validateAssessment(input, submission.message);
    if (!validation.ok) {
      fail(`Assessment rejected: ${validation.errors.join("; ")}`, {
        statusCode: 422,
        errorCode: "assessment_invalid",
        details: { errors: validation.errors },
      });
    }
    const at = now().toISOString();
    const receiptId = newId();
    const assessmentId = newId();
    const actor =
      ctx?.caller === "tool"
        ? "agent:assess_message"
        : `user:${ctx?.userEmail ?? "unknown"}`;
    await repository.transaction(async (tx) => {
      await tx.insertReceipt({
        id: receiptId,
        // The pipeline's assess_message step reuses a saved assessment by this kind.
        kind: "assess_message",
        engagementId: engagement.id,
        submissionId: submission.id,
        playbookReleaseId: engagement.playbookReleaseId,
        entryVersions: [],
        ruleResults: { validation: "passed", source: "agent" },
        inputs: {
          submission_id: submission.id,
          release_current: release.id,
        },
        agentRunId: ctx?.runId ?? null,
        // 0.176.4 exposes the run id but not a per-call id; the tool name plus run id
        // is what the trace can confirm (SPEC 5.4: receipts come from the run).
        toolCalls:
          ctx?.caller === "tool"
            ? [{ tool: "save-message-assessment", run_id: ctx.runId ?? null }]
            : null,
        model: null,
        createdAt: at,
      });
      await tx.insertAssessment({
        id: assessmentId,
        engagementId: engagement.id,
        submissionId: submission.id,
        intent: validation.value.intent,
        agencySignal: validation.value.agency_signal,
        evidenceQuotes: validation.value.evidence_quotes,
        endClientNamed: validation.value.end_client_named,
        productInterest: validation.value.product_interest,
        language: validation.value.language,
        explicitQuestion: validation.value.explicit_question,
        source: "agent",
        receiptId,
        createdAt: at,
      });
      await tx.appendEvent({
        id: newId(),
        engagementId: engagement.id,
        correlationId: submission.inboxId,
        type: "assessment.saved",
        actor,
        payload: {
          assessment_id: assessmentId,
          intent: validation.value.intent,
          source: "agent",
        },
        receiptId,
        occurredAt: at,
      });
    });
    // A live lead's run waited for this assessment; continue it now.
    let resumed: string | null = null;
    try {
      const run = await resumeAfterAgent(submission.inboxId);
      resumed = run?.status ?? null;
    } catch (error) {
      console.warn(
        "[pa] Could not resume the pipeline after the assessment:",
        error instanceof Error ? error.message : error,
      );
      resumed = "failed";
    }
    return {
      resumed,
      assessmentId,
      receiptId,
      engagementId: engagement.id,
      submissionId: submission.id,
    };
  },
});
