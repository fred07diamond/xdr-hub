// One pass of the minute poll (D58): intake, agent wake-up, decision deadlines.
import { checkDecisionDeadlines } from "./decisions.js";
import {
  INTAKE_CORRELATION,
  listAgentWork,
  pullContactSales,
  wakeInboundAgent,
} from "./live-pipeline.js";
import { newId, now, repo } from "./pa-context.js";

/** Leads are pulled from this far back each minute; the inbox key dedupes. */
const LOOKBACK_HOURS = 6;
/** With work waiting and nothing new, wake the agent at most this often. */
const REWAKE_MS = 10 * 60_000;

export async function runInboundSweep(owner: {
  userEmail: string;
  orgId?: string;
}) {
  const pulled = await pullContactSales({
    lookbackHours: LOOKBACK_HOURS,
    limit: 50,
    actor: "system:minute-poll",
  });
  const repository = repo();
  const work = await listAgentWork(repository, 50);
  let agent = "skipped";
  if (work.length > 0) {
    const events = await repository.listEventsByCorrelation(INTAKE_CORRELATION);
    const lastWake = [...events]
      .reverse()
      .find((item) => item.type === "agent.woken");
    const stale =
      !lastWake ||
      now().getTime() - Date.parse(lastWake.occurredAt) > REWAKE_MS;
    if (pulled.new > 0 || stale) {
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
  return { ...pulled, agentWork: work.length, agent, deadlines };
}
