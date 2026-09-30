// The SLA timer and the sales cycle (D51). Triage is automatic, so the timer
// is not about triage: it marks when a person contacted the lead and when the
// owner marked it SAL, against the playbook's two SLAs (rule.sla.first_touch
// and rule.sla.decision). Pure; shared by the board, the record, and the demo.
import {
  SALES_STAGES,
  type ClockView,
  type SalesStageView,
  type SlaMilestone,
  type SlaView,
  type TriageKind,
} from "../../../shared/pa-views.js";
import type { EngagementRecord, EventRecord } from "../repo/types.js";

const MINUTE = 60_000;

export function duration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const rest = total % 60;
  if (days > 0) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

const SAL_STATES = new Set(["sal"]);

/** When the owner marked the lead SAL, from the state change event. */
export function salAt(events: EventRecord[]): string | null {
  const event = events.find(
    (item) =>
      item.type === "state.changed" && SAL_STATES.has(String(item.payload.to)),
  );
  return event?.occurredAt ?? null;
}

function contactMilestone(clock: ClockView, contactedAt: string | null) {
  const label: Record<ClockView["status"], string> = {
    none: clock.reason,
    not_started: "Contact clock starts at the owner's next working hour",
    running: `Contact in ${duration(clock.remainingMinutes ?? 0)}`,
    at_risk: `Contact in ${duration(clock.remainingMinutes ?? 0)}`,
    breached: "Contact overdue",
    met: "Contacted",
  };
  return {
    applies: clock.status !== "none",
    status: clock.status,
    dueAt: clock.dueAt,
    doneAt: contactedAt,
    label: label[clock.status],
  } satisfies SlaMilestone;
}

function salMilestone(input: {
  engagement: EngagementRecord;
  salReachedAt: string | null;
  submittedAt: string;
  reminderFraction: number;
  now: Date;
}): SlaMilestone & { fraction: number | null } {
  const dueAt = input.engagement.decisionDueAt;
  if (input.salReachedAt) {
    return {
      applies: true,
      status: "met",
      dueAt,
      doneAt: input.salReachedAt,
      label: "Marked SAL",
      fraction: 1,
    };
  }
  if (!dueAt) {
    return {
      applies: false,
      status: "none",
      dueAt: null,
      doneAt: null,
      label: "No SAL decision pending",
      fraction: null,
    };
  }
  const start = new Date(input.submittedAt).getTime();
  const due = new Date(dueAt).getTime();
  const now = input.now.getTime();
  const fraction = due > start ? (now - start) / (due - start) : 1;
  const left = (due - now) / MINUTE;
  const status: ClockView["status"] =
    now >= due
      ? "breached"
      : fraction >= input.reminderFraction
        ? "at_risk"
        : "running";
  return {
    applies: true,
    status,
    dueAt,
    doneAt: null,
    label:
      status === "breached"
        ? "SAL decision overdue"
        : `SAL decision in ${duration(left)}`,
    fraction: Math.max(0, Math.min(1, fraction)),
  };
}

export function slaView(input: {
  engagement: EngagementRecord;
  clock: ClockView;
  events: EventRecord[];
  submittedAt: string;
  now: Date;
}): SlaView {
  const contact = contactMilestone(input.clock, input.engagement.firstTouchAt);
  const sal = salMilestone({
    engagement: input.engagement,
    salReachedAt: salAt(input.events),
    submittedAt: input.submittedAt,
    reminderFraction: input.clock.reminderFraction,
    now: input.now,
  });
  const { fraction: salFraction, ...salView } = sal;
  const base = {
    contact,
    sal: salView,
    reminderFraction: input.clock.reminderFraction,
  };
  if (!contact.applies && !sal.applies) {
    return {
      ...base,
      phase: "none",
      status: "none",
      label: "No SLA",
      detail: `No SLA: ${input.clock.reason.replace(/^No clock:?\s*/i, "").toLowerCase() || "nothing for a person to do"}.`,
      fraction: null,
    };
  }
  if (contact.applies && contact.status !== "met") {
    return {
      ...base,
      phase: "contact",
      status: contact.status,
      label: contact.label,
      detail:
        contact.status === "not_started"
          ? contact.label
          : `First contact is due ${contact.status === "breached" ? "and late" : "within the SLA"}. ${input.clock.reason}.`,
      fraction: input.clock.fraction,
    };
  }
  if (sal.applies && sal.status !== "met") {
    return {
      ...base,
      phase: "sal",
      status: sal.status,
      label: sal.label,
      detail: "Contacted. The owner decides SAL or not within the SLA.",
      fraction: salFraction,
    };
  }
  return {
    ...base,
    phase: "done",
    status: "met",
    label: sal.status === "met" ? "Contacted and SAL" : "Contacted",
    detail:
      sal.status === "met"
        ? "Both SLA milestones are done."
        : "Contacted. No SAL decision is pending for this lead.",
    fraction: 1,
  };
}

/**
 * Where the lead is in the sales cycle: MQL, QL, SAL, S0, NBM booked, NBM
 * complete, S1. PA records MQL through SAL and NBM booked; S0, NBM complete,
 * and S1 come from HubSpot deals once the adapter reads them.
 */
export function salesCycleView(input: {
  submittedAt: string;
  verdict: string | null;
  scoredAt: string | null;
  crmLifecycle: string | null;
  triageKind: TriageKind;
  events: EventRecord[];
}): SalesStageView[] {
  // This portal's lifecycle labels (D54, D57): QL, SAL, S0, S1 map onto the cycle.
  const lifecycle = (input.crmLifecycle ?? "").toLowerCase();
  const CRM_STAGE_RANK: Record<string, number> = {
    ql: 1,
    sal: 2,
    sql: 3,
    s0: 3,
    opportunity: 6,
    s1: 6,
    customer: 6,
    evangelist: 6,
  };
  const crmRank = CRM_STAGE_RANK[lifecycle] ?? 0;
  const inHubSpot = `HubSpot lifecycle: ${input.crmLifecycle}`;
  const bookedAt =
    input.events.find(
      (item) =>
        item.type === "state.changed" && item.payload.to === "meeting_booked",
    )?.occurredAt ?? null;
  const reached: Partial<
    Record<
      SalesStageView["code"],
      {
        at: string | null;
        note: string | null;
      }
    >
  > = {
    mql: { at: input.submittedAt, note: "Contact Sales form" },
  };
  if (input.verdict === "ql")
    reached.ql = { at: input.scoredAt, note: "Suggested by the scorecard" };
  if (crmRank >= 1) reached.ql ??= { at: null, note: inHubSpot };
  if (crmRank >= 2) reached.sal = { at: null, note: inHubSpot };
  if (crmRank >= 3) reached.s0 = { at: null, note: inHubSpot };
  if (crmRank >= 6) reached.s1 = { at: null, note: inHubSpot };
  const sal = salAt(input.events);
  if (sal) reached.sal = { at: sal, note: "Marked by the owner" };
  if (bookedAt) reached.nbm_booked = { at: bookedAt, note: null };

  const lastDone = SALES_STAGES.reduce(
    (last, stage, index) => (reached[stage.code] ? index : last),
    -1,
  );
  const stopped =
    input.triageKind === "closed" || input.triageKind === "elsewhere";
  return SALES_STAGES.map((stage, index) => {
    const hit = reached[stage.code];
    if (hit || index < lastDone)
      return {
        code: stage.code,
        label: stage.label,
        status: "done",
        at: hit?.at ?? null,
        note: hit?.note ?? null,
      };
    if (index === lastDone + 1)
      return {
        code: stage.code,
        label: stage.label,
        status: stopped ? "stopped" : "current",
        at: null,
        note: stopped ? "Not a sales opportunity" : null,
      };
    return {
      code: stage.code,
      label: stage.label,
      status: "upcoming",
      at: null,
      note: ["s0", "nbm_complete", "s1"].includes(stage.code)
        ? "Read from HubSpot deals once the adapter lands"
        : null,
    };
  });
}
