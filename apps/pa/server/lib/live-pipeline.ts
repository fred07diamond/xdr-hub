// The live inbound path (D54): real Contact Sales submissions from HubSpot run
// through the same pipeline as replay, with the HubSpot adapter and the agent
// for message assessment and drafting. Shadow only: nothing is sent and
// nothing is written to the CRM.
import { queueAutomationRunNow } from "@agent-native/core/triggers";
import { hubspotFetchWithTimeout } from "@xdr-hub/shared/server";

import {
  HubSpotCrmAdapter,
  type HubSpotFetch,
  type HubSpotMapping,
} from "../core/crm/hubspot-adapter.js";
import { draftPlan } from "../core/drafting/index.js";
import {
  enqueueSubmissions,
  excludeSubmissions,
  HUBSPOT_SOURCE,
  portalIdOf,
  searchContactSales,
} from "../core/intake/hubspot.js";
import { runPipeline } from "../core/pipeline/runner.js";
import type { PipelineDeps } from "../core/pipeline/types.js";
import type { PaRepository } from "../core/repo/types.js";
import { activeRelease, newId, now, repo } from "./pa-context.js";

export const INBOUND_AGENT = "pa-inbound-agent";
export const INTAKE_CORRELATION = "hubspot-intake";

export const hubspotFetch: HubSpotFetch = (path, init) =>
  hubspotFetchWithTimeout(path, init);

export async function liveDeps(): Promise<PipelineDeps> {
  const release = await activeRelease();
  const mapping = (release.config.hubspot_mapping ?? {}) as HubSpotMapping;
  return {
    repo: repo(),
    crm: new HubSpotCrmAdapter(hubspotFetch, mapping, now),
    release,
    // The agent saves both through save-message-assessment and save-draft;
    // until it does, the pipeline waits instead of failing.
    assessor: {
      source: "agent",
      waitsForAgent: true,
      assess: async () => null,
    },
    drafter: { source: "agent", waitsForAgent: true, draft: async () => null },
    now,
    newId,
    // Never a synthetic pool for a real lead.
    devPool: [],
    mode: "shadow",
  };
}

/** Runs pending HubSpot rows until the time budget is used; the rest wait for the next pull. */
export async function processPending(
  deps: PipelineDeps,
  budgetMs = 20_000,
): Promise<{ processed: number; failed: number; remaining: number }> {
  const started = Date.now();
  const pending = await deps.repo.listInboxBySource(
    HUBSPOT_SOURCE,
    ["pending"],
    50,
  );
  let processed = 0;
  let failed = 0;
  for (const row of pending) {
    if (Date.now() - started > budgetMs) break;
    const result = await runPipeline(row.id, deps);
    processed += 1;
    if (result.status === "failed") failed += 1;
  }
  return { processed, failed, remaining: pending.length - processed };
}

/**
 * After the agent saves an assessment, the halted run continues from the
 * pre-check. The row is reopened with fresh attempts: waiting on the agent
 * was not a failed attempt.
 */
export async function resumeAfterAgent(inboxId: string) {
  const repository = repo();
  const inbox = await repository.getInbox(inboxId);
  if (!inbox || inbox.source !== HUBSPOT_SOURCE) return null;
  if (inbox.status !== "done" && inbox.status !== "pending") return null;
  await repository.updateInbox(
    inbox.id,
    {
      status: "pending",
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      updatedAt: now().toISOString(),
    },
    inbox.version,
  );
  return runPipeline(inbox.id, await liveDeps());
}

export async function pullContactSales(input: {
  lookbackHours: number;
  limit: number;
  actor: string;
}) {
  const deps = await liveDeps();
  const since = new Date(now().getTime() - input.lookbackHours * 3_600_000);
  const portalId = await portalIdOf(hubspotFetch);
  const { submissions, excluded } = await searchContactSales(hubspotFetch, {
    since,
    limit: input.limit,
    portalId,
  });
  const created = await enqueueSubmissions(deps.repo, submissions, {
    now,
    newId,
  });
  const hidden = await excludeSubmissions(deps.repo, excluded, now);
  const run = await processPending(deps);
  await deps.repo.appendEvent({
    id: newId(),
    engagementId: null,
    correlationId: INTAKE_CORRELATION,
    type: "intake.pulled",
    actor: input.actor,
    payload: {
      found: submissions.length,
      new: created.length,
      not_contact_sales: excluded.length,
      hidden,
      processed: run.processed,
      failed: run.failed,
      remaining: run.remaining,
      lookback_hours: input.lookbackHours,
    },
    receiptId: null,
    occurredAt: now().toISOString(),
  });
  return {
    found: submissions.length,
    new: created.length,
    notContactSales: excluded.length,
    hidden,
    ...run,
  };
}

export interface AgentWorkItem {
  engagementId: string;
  step: "assess_message" | "draft";
  lead: string;
  submittedAt: string;
}

/** What the agent owes: live leads waiting for an assessment or a draft. */
export async function listAgentWork(
  repository: PaRepository,
  limit = 20,
): Promise<AgentWorkItem[]> {
  const rows = await repository.listInboxBySource(
    HUBSPOT_SOURCE,
    ["done", "pending"],
    500,
  );
  const work: AgentWorkItem[] = [];
  for (const row of rows) {
    if (work.length >= limit) break;
    const submission = await repository.getSubmissionByInbox(row.id);
    if (!submission?.engagementId) continue;
    const engagement = await repository.getEngagement(submission.engagementId);
    if (!engagement) continue;
    const lead = submission.name ?? submission.email;
    if (!(await repository.getAssessmentForSubmission(submission.id))) {
      work.push({
        engagementId: engagement.id,
        step: "assess_message",
        lead,
        submittedAt: submission.submittedAt,
      });
      continue;
    }
    const precheck = await repository.findReceipt("precheck", submission.id);
    const plan = draftPlan({
      state: engagement.state,
      precheck: (precheck?.ruleResults.outcome as string | undefined) ?? null,
      hasOwner: Boolean(engagement.ownerUserId),
    });
    if (
      plan.needed &&
      (await repository.listDrafts(engagement.id)).length === 0
    )
      work.push({
        engagementId: engagement.id,
        step: "draft",
        lead,
        submittedAt: submission.submittedAt,
      });
  }
  return work;
}

/** Wakes the inbound agent. Fails soft: the scheduled run picks work up anyway. */
export async function wakeInboundAgent(ctx: {
  userEmail?: string | null;
  orgId?: string | null;
}): Promise<"queued" | "not_enabled" | "skipped" | "failed"> {
  if (!ctx.userEmail || !ctx.orgId) return "skipped";
  try {
    await queueAutomationRunNow({
      userEmail: ctx.userEmail,
      orgId: ctx.orgId,
      appId: "pa",
      scope: "organization",
      name: INBOUND_AGENT,
    });
    return "queued";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not found|no automation|does not exist|404/i.test(message))
      return "not_enabled";
    console.warn("[pa] Could not wake the inbound agent:", message);
    return "failed";
  }
}
