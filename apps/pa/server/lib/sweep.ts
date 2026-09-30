// One pass of the minute poll (D58): intake, agent wake-up, decision deadlines.
import { checkDecisionDeadlines } from "./decisions.js";
import {
  processRefreshQueue,
  ensureInboundAgent,
  INTAKE_CORRELATION,
  listAgentWork,
  pullContactSales,
  wakeInboundAgent,
} from "./live-pipeline.js";
import { newId, now, repo } from "./pa-context.js";

/** Leads are pulled from this far back each minute; the inbox key dedupes. */
const LOOKBACK_HOURS = 6;
/**
 * With work waiting and nothing new, wake the agent again after this long.
 * One run works the whole queue, so this only matters when a run stalled.
 */
const REWAKE_MS = 3 * 60_000;

export async function runInboundSweep(owner: {
  userEmail: string;
  orgId?: string;
}) {
  const pulled = await pullContactSales({
    lookbackHours: LOOKBACK_HOURS,
    limit: 50,
    actor: "system:minute-poll",
  });
  // Refresh requests (D63) before counting work, so refreshed leads are woken too.
  const refresh = await processRefreshQueue(15_000);
  const repository = repo();
  const work = await listAgentWork(repository, 50);
  // Checked every minute, so a change to the agent's instructions or model
  // reaches the running automation without anyone pressing a button.
  const agentSetup = await ensureInboundAgent(owner);
  let agent = "skipped";
  if (work.length > 0) {
    const events = await repository.listEventsByCorrelation(INTAKE_CORRELATION);
    const lastWake = [...events]
      .reverse()
      .find((item) => item.type === "agent.woken");
    const stale =
      !lastWake ||
      now().getTime() - Date.parse(lastWake.occurredAt) > REWAKE_MS;
    // Only a run that was actually queued counts as a wake-up.
    const lastQueued = [...events]
      .reverse()
      .find(
        (item) =>
          item.type === "agent.woken" && item.payload.result === "queued",
      );
    const due =
      !lastQueued ||
      now().getTime() - Date.parse(lastQueued.occurredAt) > REWAKE_MS;
    if (pulled.new > 0 || refresh.refreshed > 0 || due) {
      agent = await wakeInboundAgent(owner);
      await repository.appendEvent({
        id: newId(),
        engagementId: null,
        correlationId: INTAKE_CORRELATION,
        type: "agent.woken",
        actor: "system:minute-poll",
        payload: { result: agent, work: work.length },
        receiptId: null,
        occurredAt: now().toISOString(),
      });
    }
  }
  const deadlines = await checkDecisionDeadlines(owner);
  return {
    ...pulled,
    agentWork: work.length,
    refresh,
    agentSetup,
    agent,
    org: Boolean(owner.orgId),
    deadlines,
  };
}
