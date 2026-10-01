// The rep decision loop (workflow 2b, D59). Every lead PA qualifies for a rep
// gets one decision: accept and sequence, decline and recycle, or research
// more. With a meeting already booked, the decision is what to do with the
// meeting. PA recommends; the rep decides within 24 hours. A missed deadline
// is recorded and alerted, never executed (Fred, 2026-09-30). Decisions
// change the lead in PA only; HubSpot is not written.
import type { CrmSnapshot } from "../crm/port.js";
import { assertTransition, type EngagementState } from "../objects/index.js";
import { rule } from "../playbook/resolve.js";
import type { PlaybookRelease } from "../playbook/schema.js";
import { DEFAULT_THRESHOLDS, qualifyThresholds } from "../qualify/index.js";
import type {
  DecisionRecord,
  EngagementRecord,
  PaRepository,
} from "../repo/types.js";

export const STANDARD_CHOICES = ["accept", "decline", "research"] as const;
export const MEETING_CHOICES = [
  "take_meeting",
  "disqualify",
  "bring_in_ae",
  "route_elsewhere",
] as const;
export const CUSTOMER_REDIRECT = "customer_redirect";

export type Choice =
  | (typeof STANDARD_CHOICES)[number]
  | (typeof MEETING_CHOICES)[number]
  | typeof CUSTOMER_REDIRECT;

export const CHOICE_LABELS: Record<Choice, string> = {
  accept: "Accept and sequence",
  decline: "Decline and recycle",
  research: "Research more",
  take_meeting: "Take the meeting",
  disqualify: "Disqualify",
  bring_in_ae: "Bring in an AE",
  route_elsewhere: "Route elsewhere",
  customer_redirect: "Customer redirect (AE and CSM)",
};

/** Where each choice moves the lead in PA, and the outcome it records. */
const CHOICE_EFFECTS: Record<
  Choice,
  { path: EngagementState[]; outcome: string | null } | null
> = {
  accept: { path: ["ql", "sal"], outcome: "accepted" },
  take_meeting: { path: ["ql", "sal"], outcome: "meeting_taken" },
  decline: { path: ["recycled"], outcome: "recycled" },
  disqualify: { path: ["disqualified"], outcome: "disqualified_by_rep" },
  bring_in_ae: { path: ["closed"], outcome: "handed_to_ae" },
  route_elsewhere: { path: ["closed"], outcome: "routed_elsewhere" },
  customer_redirect: { path: ["closed"], outcome: "customer_redirect" },
  research: null,
};

const MEETING_WINDOW_MS = 30 * 60_000;

export interface DecisionInputs {
  engagement: EngagementRecord;
  submittedAt: string;
  precheckOutcome: string | null;
  signal: string | null;
  verdict: string | null;
  snapshot: CrmSnapshot | null;
  flagged: boolean;
  ownerEmail: string | null;
  /** Intent score at or under the playbook's recycle line (D67). */
  suggestRecycle?: { score: number } | null;
}

/**
 * Leads with a PA decision: a legitimate sales request (pre-check continue),
 * or an owned account or active conversation, or an existing customer whose
 * team PA cannot tell (workflow 1b: never assume). Open deals go to the AE,
 * and support, educational, junk, and restricted leads are settled.
 */
export function needsDecision(input: DecisionInputs): boolean {
  if (input.precheckOutcome === "continue") return true;
  if (input.precheckOutcome !== "attach_to_owner") return false;
  if (input.signal === "existing_deal_or_customer")
    return (input.snapshot?.openDeals.length ?? 0) === 0;
  return true;
}

export function isCustomerWithoutDeal(input: DecisionInputs) {
  return (
    input.signal === "existing_deal_or_customer" &&
    (input.snapshot?.openDeals.length ?? 0) === 0
  );
}

/** A meeting booked at or after the submission (the owner's link on the site). */
export function meetingBookedAt(input: DecisionInputs): string | null {
  const booked = input.snapshot?.contact?.meetingBookedAt ?? null;
  if (!booked) return null;
  return Date.parse(booked) >= Date.parse(input.submittedAt) - MEETING_WINDOW_MS
    ? booked
    : null;
}

export function recommend(input: DecisionInputs): {
  kind: DecisionRecord["kind"];
  options: Choice[];
  recommendation: Choice;
  reason: string;
  question: string | null;
} {
  const customer = isCustomerWithoutDeal(input);
  const question = customer
    ? "Is this person on the team already using Builder (redirect to their AE and CSM), or on a different team or business unit (an expansion lead)?"
    : null;
  const extra: Choice[] = customer ? [CUSTOMER_REDIRECT] : [];
  if (meetingBookedAt(input)) {
    return {
      kind: "meeting_booked",
      options: [...MEETING_CHOICES, ...extra],
      recommendation:
        input.verdict === "ql" ? "take_meeting" : "route_elsewhere",
      reason:
        input.verdict === "ql"
          ? "They booked a meeting and the request qualifies."
          : "They booked a meeting, but the request does not qualify as a sales lead.",
      question,
    };
  }
  const options: Choice[] = [...STANDARD_CHOICES, ...extra];
  if (input.flagged)
    return {
      kind: "standard",
      options,
      recommendation: "research",
      reason:
        "The message is flagged for review. Read it before deciding; nothing in it was followed.",
      question,
    };
  if (customer)
    return {
      kind: "standard",
      options,
      recommendation: "research",
      reason: "An existing customer. PA cannot tell which team they are on.",
      question,
    };
  if (input.suggestRecycle && input.precheckOutcome !== "attach_to_owner")
    return {
      kind: "standard",
      options,
      recommendation: "decline",
      reason: `Intent score ${input.suggestRecycle.score} of 10: suggest recycle with a note.`,
      question,
    };
  if (input.verdict === "ql" || input.precheckOutcome === "attach_to_owner")
    return {
      kind: "standard",
      options,
      recommendation: "accept",
      reason:
        input.precheckOutcome === "attach_to_owner"
          ? "An owned account with a sales request. The owner works it."
          : "A legitimate sales request that meets the QL definition.",
      question,
    };
  if (input.verdict === "recycle")
    return {
      kind: "standard",
      options,
      recommendation: "decline",
      reason: "No sales request yet. Recycle with a note.",
      question,
    };
  return {
    kind: "standard",
    options,
    recommendation: "research",
    reason: "The scorecard does not settle it yet.",
    question,
  };
}

export interface DecisionDeps {
  repo: PaRepository;
  release: PlaybookRelease;
  now: () => Date;
  newId: () => string;
}

/** Reads what the pipeline recorded for an engagement's latest submission. */
export async function decisionInputs(
  repo: PaRepository,
  engagement: EngagementRecord,
  release?: PlaybookRelease,
): Promise<DecisionInputs | null> {
  const submissions = await repo.listSubmissionsForEngagement(engagement.id);
  const latest = submissions[submissions.length - 1];
  if (!latest) return null;
  const precheck = await repo.findReceipt("precheck", latest.id);
  if (!precheck) return null;
  const snapshot = await repo.findReceipt("crm_snapshot", latest.id);
  const route = await repo.findReceipt("route", latest.id);
  const scorecards = await repo.listScorecards(engagement.id);
  const owner = engagement.ownerUserId
    ? await repo.getProfile(engagement.ownerUserId)
    : null;
  const routedOwner = (
    route?.ruleResults.routing as
      | { owner?: { email?: string } | null }
      | undefined
  )?.owner;
  return {
    engagement,
    submittedAt: latest.submittedAt,
    precheckOutcome:
      (precheck.ruleResults.outcome as string | undefined) ?? null,
    signal: (precheck.ruleResults.signal as string | null | undefined) ?? null,
    verdict: scorecards[scorecards.length - 1]?.verdict ?? null,
    snapshot:
      (snapshot?.ruleResults.snapshot as CrmSnapshot | undefined) ?? null,
    flagged: engagement.reviewFlags.length > 0,
    ownerEmail: owner?.email ?? routedOwner?.email ?? null,
    suggestRecycle: recycleSignal(latest.fields, release),
  };
}

function recycleSignal(
  fields: Record<string, unknown>,
  release: PlaybookRelease | undefined,
): { score: number } | null {
  const raw = fields.breeze_fit_score;
  const score = typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
  if (!Number.isFinite(score)) return null;
  const line =
    qualifyThresholds(release).intent_recycle ??
    DEFAULT_THRESHOLDS.intent_recycle;
  return score <= line ? { score } : null;
}

/** Creates the engagement's decision once, when it needs one. */
export async function ensureDecision(
  deps: DecisionDeps,
  engagementId: string,
  options: { dueFrom?: "submission" | "now" } = {},
): Promise<DecisionRecord | null> {
  const existing = await deps.repo.getDecision(engagementId);
  if (existing) return existing;
  const engagement = await deps.repo.getEngagement(engagementId);
  if (!engagement) return null;
  const inputs = await decisionInputs(deps.repo, engagement, deps.release);
  if (!inputs || !needsDecision(inputs)) return null;
  const hours = rule(deps.release, "rule.sla.decision").params.hours;
  const advice = recommend(inputs);
  const at = deps.now().toISOString();
  const record: DecisionRecord = {
    id: deps.newId(),
    engagementId,
    kind: advice.kind,
    options: advice.options,
    recommendation: advice.recommendation,
    recommendationReason: advice.reason,
    question: advice.question,
    ownerEmail: inputs.ownerEmail,
    // A lead backfilled from before the loop gets a fresh window, not a miss.
    dueAt: new Date(
      (options.dueFrom === "now"
        ? deps.now().getTime()
        : Date.parse(inputs.submittedAt)) +
        hours * 3_600_000,
    ).toISOString(),
    status: "open",
    choice: null,
    note: null,
    decidedBy: null,
    decidedAt: null,
    slaMissedAt: null,
    version: 1,
    createdAt: at,
    updatedAt: at,
  };
  if (!(await deps.repo.insertDecisionIfAbsent(record)))
    return deps.repo.getDecision(engagementId);
  await deps.repo.appendEvent({
    id: deps.newId(),
    engagementId,
    correlationId: engagementId,
    type: "decision.requested",
    actor: "system",
    payload: {
      recommendation: advice.recommendation,
      due_at: record.dueAt,
      kind: advice.kind,
    },
    receiptId: null,
    occurredAt: at,
  });
  return record;
}

export class DecisionError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

/** Applies the rep's choice in PA. Research keeps the decision open. */
export async function decide(
  deps: DecisionDeps,
  input: {
    engagementId: string;
    choice: Choice;
    note: string | null;
    actor: string;
  },
): Promise<DecisionRecord> {
  return deps.repo.transaction(async (tx) => {
    const decision = await tx.getDecision(input.engagementId);
    if (!decision) throw new DecisionError("This lead has no decision", 404);
    if (decision.status === "decided")
      throw new DecisionError(
        `Already decided: ${CHOICE_LABELS[decision.choice as Choice] ?? decision.choice}`,
        409,
      );
    if (!decision.options.includes(input.choice))
      throw new DecisionError(
        `${CHOICE_LABELS[input.choice]} is not an option for this lead`,
      );
    const at = deps.now().toISOString();
    const effect = CHOICE_EFFECTS[input.choice];
    if (effect) {
      let engagement = await tx.getEngagement(input.engagementId);
      if (!engagement) throw new DecisionError("Engagement not found", 404);
      for (const to of effect.path) {
        const from = engagement.state as EngagementState;
        if (from === to) continue;
        assertTransition(from, to);
        engagement = await tx.updateEngagement(
          engagement.id,
          {
            state: to,
            updatedAt: at,
            ...(effect.outcome ? { outcome: effect.outcome } : {}),
            ...(input.choice === CUSTOMER_REDIRECT
              ? { relationshipState: "customer" }
              : {}),
          },
          engagement.version,
        );
        await tx.appendEvent({
          id: deps.newId(),
          engagementId: engagement.id,
          correlationId: engagement.id,
          type: "state.changed",
          actor: input.actor,
          payload: { from, to, via: "decision" },
          receiptId: null,
          occurredAt: at,
        });
      }
    }
    const updated = await tx.updateDecision(
      decision.id,
      effect
        ? {
            status: "decided",
            choice: input.choice,
            note: input.note,
            decidedBy: input.actor,
            decidedAt: at,
            updatedAt: at,
          }
        : { note: input.note ?? decision.note, updatedAt: at },
      decision.version,
    );
    await tx.appendEvent({
      id: deps.newId(),
      engagementId: input.engagementId,
      correlationId: input.engagementId,
      type: effect ? "decision.made" : "decision.research",
      actor: input.actor,
      payload: {
        choice: input.choice,
        recommendation: decision.recommendation,
        followed: input.choice === decision.recommendation,
        note: input.note,
        late: Boolean(decision.slaMissedAt),
      },
      receiptId: null,
      occurredAt: at,
    });
    return updated;
  });
}

/** Marks open decisions past their deadline, once each. Returns the newly missed. */
export async function markMissedDeadlines(
  deps: DecisionDeps,
): Promise<DecisionRecord[]> {
  const now = deps.now();
  const missed: DecisionRecord[] = [];
  for (const decision of await deps.repo.listOpenDecisions()) {
    if (decision.slaMissedAt || Date.parse(decision.dueAt) > now.getTime())
      continue;
    const updated = await deps.repo.updateDecision(
      decision.id,
      { slaMissedAt: now.toISOString(), updatedAt: now.toISOString() },
      decision.version,
    );
    await deps.repo.appendEvent({
      id: deps.newId(),
      engagementId: decision.engagementId,
      correlationId: decision.engagementId,
      type: "decision.sla_missed",
      actor: "system",
      payload: {
        owner: decision.ownerEmail,
        recommendation: decision.recommendation,
        due_at: decision.dueAt,
      },
      receiptId: null,
      occurredAt: now.toISOString(),
    });
    missed.push(updated);
  }
  return missed;
}
