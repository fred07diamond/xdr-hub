// The lead's lifecycle stage as HubSpot has it now (D83): the latest re-check
// if there is one, else the snapshot taken when the lead was read. The SLA
// timer and the decision follow it, so a lead recycled or made SAL in
// HubSpot reads the same in PA.
import type { PaRepository } from "../repo/types.js";

export type HubSpotStage = "sal" | "recycle" | "disqualified" | null;

const PAST_QL = new Set([
  "sal",
  "sql",
  "s0",
  "s1",
  "opportunity",
  "customer",
  "evangelist",
  "closed",
]);

/** What a HubSpot lifecycle means for PA's SAL decision. */
export function hubspotStage(
  lifecycle: string | null | undefined,
): HubSpotStage {
  const value = (lifecycle ?? "").trim().toLowerCase();
  if (PAST_QL.has(value)) return "sal";
  if (value === "recycle") return "recycle";
  if (value === "disqualified" || value === "excluded") return "disqualified";
  return null;
}

export const LIFECYCLE_EVENT = "crm.lifecycle_checked";

/** The latest lifecycle: a re-check event, else the snapshot's. */
export function latestLifecycle(
  events: Array<{ type: string; payload: Record<string, unknown> }>,
  snapshotLifecycle: string | null | undefined,
): string | null {
  const checked = [...events]
    .reverse()
    .find((item) => item.type === LIFECYCLE_EVENT);
  const value = checked?.payload.lifecycle;
  if (typeof value === "string" && value.trim()) return value;
  return snapshotLifecycle ?? null;
}

export async function lifecycleOfEngagement(
  repo: PaRepository,
  engagementId: string,
): Promise<string | null> {
  const [events, receipts] = await Promise.all([
    repo.listEvents(engagementId),
    repo.listReceipts(engagementId),
  ]);
  const snapshot = [...receipts]
    .reverse()
    .find((item) => item.kind === "crm_snapshot")?.ruleResults.snapshot as
    | { contact?: { lifecycleRaw?: string | null } | null }
    | undefined;
  return latestLifecycle(events, snapshot?.contact?.lifecycleRaw);
}

/**
 * Whether HubSpot has moved the lead past PA (D90): a stage of SAL or later
 * (S0 included), Recycle, or Disqualified, or a deal on the contact created
 * after the form. The lead leaves the queue and PA does nothing more.
 */
export interface MovedOn {
  reason: string;
  stage: HubSpotStage;
}

export function movedOnOf(
  events: Array<{ type: string; payload: Record<string, unknown> }>,
  snapshotLifecycle: string | null | undefined,
): MovedOn | null {
  const lifecycle = latestLifecycle(events, snapshotLifecycle);
  const stage = hubspotStage(lifecycle);
  const checked = [...events]
    .reverse()
    .find((item) => item.type === LIFECYCLE_EVENT);
  const deal = checked?.payload.deal_after_form === true;
  if (deal)
    return {
      reason: "A deal was created after the form",
      stage: stage ?? "sal",
    };
  if (!stage) return null;
  // Customers are handled as existing customers, not as a lead moving on.
  if (/^(customer|evangelist)$/i.test((lifecycle ?? "").trim())) return null;
  return {
    reason:
      stage === "sal"
        ? `${lifecycle} in HubSpot`
        : stage === "recycle"
          ? "Recycled in HubSpot"
          : "Disqualified in HubSpot",
    stage,
  };
}

export async function movedOnOfEngagement(
  repo: PaRepository,
  engagementId: string,
): Promise<MovedOn | null> {
  const [events, receipts] = await Promise.all([
    repo.listEvents(engagementId),
    repo.listReceipts(engagementId),
  ]);
  const snapshot = [...receipts]
    .reverse()
    .find((item) => item.kind === "crm_snapshot")?.ruleResults.snapshot as
    | { contact?: { lifecycleRaw?: string | null } | null }
    | undefined;
  return movedOnOf(events, snapshot?.contact?.lifecycleRaw);
}
