import {
  PRECHECK_LABELS,
  ROUTE_LABELS,
  STATE_LABELS,
  type EngagementState,
  type PrecheckOutcome,
  type Route,
} from "../objects/index.js";
import type { EventRecord } from "../repo/types.js";

export const OWNER_SOURCE_LABELS: Record<string, string> = {
  crm_contact_owner: "CRM contact owner",
  crm_deal_owner: "Deal owner",
  crm_customer_owner: "Customer owner",
  crm_company_owner: "Account owner",
  partner_rep: "Partner rep",
  round_robin: "Round robin",
  support_queue: "Support queue",
};

export const RECEIPT_LABELS: Record<string, string> = {
  normalize: "Intake and identity",
  crm_snapshot: "CRM snapshot",
  assess_message: "Message assessment",
  precheck: "Pre-check",
  route: "Route and clocks",
  score: "Scorecard",
  draft: "Draft and lint",
  save_message_assessment: "Assessment saved by agent",
};

const EVENT_LABELS: Record<string, string> = {
  "submission.received": "Submission received",
  "engagement.created": "Engagement created",
  "submission.attached_to_open": "Attached to an open engagement",
  "untrusted.flagged": "Flagged for review",
  "crm.snapshot_taken": "CRM snapshot taken",
  "message.assessed": "Message assessed",
  "assessment.saved": "Assessment saved by agent",
  "precheck.completed": "Pre-check completed",
  "state.changed": "State changed",
  "engagement.routed": "Routed",
  "route.unchanged": "Route unchanged",
  "clock.started": "Clock started",
  "clock.not_applicable": "No clock",
  "scorecard.written": "Scorecard written",
  "draft.proposed": "Draft proposed",
  "agent.work_requested": "Agent asked",
  "step.skipped": "Step skipped",
  "pipeline.completed": "Pipeline completed",
  "pipeline.failed": "Pipeline failed",
  "pipeline.retry_scheduled": "Retry scheduled",
};

export function stateLabel(state: string): string {
  return STATE_LABELS[state as EngagementState] ?? state;
}

export function routeLabel(route: string | null): string {
  return route ? (ROUTE_LABELS[route as Route] ?? route) : "Not routed";
}

export function precheckLabel(outcome: string): string {
  return PRECHECK_LABELS[outcome as PrecheckOutcome] ?? outcome;
}

export function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type;
}

export function eventDetail(event: EventRecord): string | null {
  const payload = event.payload;
  switch (event.type) {
    case "state.changed":
      return `${stateLabel(String(payload.from))} to ${stateLabel(String(payload.to))}`;
    case "precheck.completed":
      return payload.signal
        ? `${precheckLabel(String(payload.outcome))} (${String(payload.signal).replace(/_/g, " ")})`
        : precheckLabel(String(payload.outcome));
    case "engagement.routed":
      return `${routeLabel(String(payload.route))}${payload.owner ? `: ${String(payload.owner)}` : ""}`;
    case "crm.snapshot_taken":
      return payload.found
        ? `${String(payload.source)}: ${payload.lifecycle ?? "no lifecycle"}, ${payload.open_deals} open deals`
        : `${String(payload.source)}: no CRM contact`;
    case "message.assessed":
    case "assessment.saved":
      return `Intent ${String(payload.intent)}, ${String(payload.source).replace(/_/g, " ")}`;
    case "scorecard.written":
      return `Suggested verdict ${String(payload.verdict).replace(/_/g, " ")}, v${payload.version}`;
    case "agent.work_requested":
      return payload.step === "draft"
        ? "Asked the agent for a draft reply"
        : "Asked the agent to read the message";
    case "draft.proposed":
      return payload.lint_ok
        ? "Passes the message rules"
        : `${String(payload.problems)} message rule problems`;
    case "step.skipped":
      return `${String(payload.step)} skipped until ${String(payload.reason)}`;
    case "clock.not_applicable":
      return String(payload.reason ?? "");
    case "untrusted.flagged":
      return `Matched: ${((payload.patterns as string[] | undefined) ?? []).map((pattern) => pattern.replace(/_/g, " ")).join(", ")}`;
    case "pipeline.failed":
    case "pipeline.retry_scheduled":
      return `${String(payload.step)}: ${String(payload.reason ?? "")}`;
    default:
      return null;
  }
}
