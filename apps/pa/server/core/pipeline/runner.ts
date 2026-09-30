import { InvalidTransitionError } from "../objects/index.js";
import { VersionConflictError, type InboxRecord } from "../repo/types.js";
import { STEPS, type PipelineStep } from "./steps.js";
import {
  PermanentStepError,
  type PipelineDeps,
  type PipelineRunResult,
  type PipelineState,
  type StepOutcome,
  type StepResult,
} from "./types.js";

export const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000];

/**
 * How long a `processing` claim is held before the sweep may take it over.
 * Longer than a bounded agent step, shorter than the background function
 * budget, so a crashed run is recovered but a live one is never run twice.
 */
export const CLAIM_LEASE_MS = 10 * 60_000;

export class InboxNotFoundError extends Error {}

/**
 * SPEC 5.2 and 5.3: only errors that retrying cannot fix fail at once.
 * Everything else (a dropped connection, a unique-key race, a version
 * conflict) is retried with backoff, up to MAX_ATTEMPTS.
 */
export function isPermanentError(error: unknown): boolean {
  return (
    error instanceof PermanentStepError ||
    error instanceof InvalidTransitionError
  );
}

async function claim(
  deps: PipelineDeps,
  inboxId: string,
): Promise<InboxRecord | null> {
  const inbox = await deps.repo.getInbox(inboxId);
  if (!inbox) throw new InboxNotFoundError(`Inbox row ${inboxId} not found`);
  if (
    inbox.status === "done" ||
    inbox.status === "skipped" ||
    inbox.status === "failed"
  )
    return null;
  const now = deps.now();
  if (
    inbox.status === "pending" &&
    inbox.nextAttemptAt &&
    new Date(inbox.nextAttemptAt) > now
  )
    return null;
  if (
    inbox.status === "processing" &&
    now.getTime() - new Date(inbox.updatedAt).getTime() < CLAIM_LEASE_MS
  ) {
    return null;
  }
  if (inbox.attempts >= MAX_ATTEMPTS) {
    // A run that crashed on its last attempt never reached the failure path.
    try {
      await deps.repo.updateInbox(
        inbox.id,
        {
          status: "failed",
          lastError:
            inbox.lastError ?? "Attempts exhausted without a recorded result",
          nextAttemptAt: null,
          updatedAt: now.toISOString(),
        },
        inbox.version,
      );
      await deps.repo.appendEvent({
        id: deps.newId(),
        engagementId: null,
        correlationId: inbox.id,
        type: "pipeline.failed",
        actor: "system",
        payload: {
          step: null,
          reason: "attempts_exhausted",
          attempts: inbox.attempts,
        },
        receiptId: null,
        occurredAt: now.toISOString(),
      });
    } catch (error) {
      if (!(error instanceof VersionConflictError)) throw error;
    }
    return null;
  }
  try {
    return await deps.repo.updateInbox(
      inbox.id,
      {
        status: "processing",
        attempts: inbox.attempts + 1,
        updatedAt: deps.now().toISOString(),
      },
      inbox.version,
    );
  } catch (error) {
    if (error instanceof VersionConflictError) return null;
    throw error;
  }
}

async function summary(
  deps: PipelineDeps,
  inboxId: string,
  status: PipelineRunResult["status"],
  steps: StepResult[],
  error?: string,
): Promise<PipelineRunResult> {
  const submission = await deps.repo.getSubmissionByInbox(inboxId);
  return {
    inboxId,
    status,
    engagementId: submission?.engagementId ?? null,
    steps,
    ...(error ? { error } : {}),
  };
}

async function runStep(
  deps: PipelineDeps,
  step: PipelineStep,
  state: PipelineState,
): Promise<StepOutcome> {
  try {
    return await deps.repo.transaction((repo) =>
      step.run({ ...deps, repo }, state),
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { status: isPermanentError(error) ? "fail" : "retry", reason };
  }
}

export async function runPipeline(
  inboxId: string,
  deps: PipelineDeps,
  steps: PipelineStep[] = STEPS,
): Promise<PipelineRunResult> {
  const inbox = await claim(deps, inboxId);
  if (!inbox) {
    const current = await deps.repo.getInbox(inboxId);
    const status =
      current?.status === "done" || current?.status === "skipped"
        ? "done"
        : current?.status === "failed"
          ? "failed"
          : "pending";
    return summary(deps, inboxId, status, []);
  }

  const state: PipelineState = { inbox };
  const results: StepResult[] = [];

  for (const step of steps) {
    if (await step.isDone(deps, state)) {
      await step.hydrate(deps, state);
      results.push({ step: step.name, status: "done", reused: true });
      continue;
    }
    const outcome = await runStep(deps, step, state);
    results.push({ step: step.name, reused: false, ...outcome });

    if (outcome.status === "retry" || outcome.status === "fail") {
      const current = (await deps.repo.getInbox(inboxId)) as InboxRecord;
      const exhausted =
        outcome.status === "fail" || current.attempts >= MAX_ATTEMPTS;
      const now = deps.now();
      await deps.repo.updateInbox(
        inboxId,
        {
          status: exhausted ? "failed" : "pending",
          lastError: `${step.name}: ${outcome.reason ?? outcome.status}`,
          nextAttemptAt: exhausted
            ? null
            : new Date(
                now.getTime() +
                  RETRY_BACKOFF_MS[Math.min(current.attempts - 1, 2)],
              ).toISOString(),
          updatedAt: now.toISOString(),
        },
        current.version,
      );
      await deps.repo.appendEvent({
        id: deps.newId(),
        engagementId: state.engagement?.id ?? null,
        correlationId: inboxId,
        type: exhausted ? "pipeline.failed" : "pipeline.retry_scheduled",
        actor: "system",
        payload: {
          step: step.name,
          reason: outcome.reason ?? null,
          attempts: current.attempts,
        },
        receiptId: null,
        occurredAt: now.toISOString(),
      });
      return summary(
        deps,
        inboxId,
        exhausted ? "failed" : "pending",
        results,
        outcome.reason,
      );
    }
    if (outcome.status === "halt") break;
  }

  const current = (await deps.repo.getInbox(inboxId)) as InboxRecord;
  const now = deps.now().toISOString();
  await deps.repo.updateInbox(
    inboxId,
    { status: "done", lastError: null, nextAttemptAt: null, updatedAt: now },
    current.version,
  );
  await deps.repo.appendEvent({
    id: deps.newId(),
    engagementId: state.engagement?.id ?? null,
    correlationId: inboxId,
    type: "pipeline.completed",
    actor: "system",
    payload: {
      steps: results.map((result) => `${result.step}:${result.status}`),
    },
    receiptId: null,
    occurredAt: now,
  });
  return summary(deps, inboxId, "done", results);
}
