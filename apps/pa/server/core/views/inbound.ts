import type {
  AnswerView,
  BoardResult,
  BoardRow,
  BoardTab,
  CitationView,
  ClockView,
  DraftSummary,
  EngagementDetail,
  EvaluationView,
  LeadRouteView,
  OpenItemView,
  OwnerView,
  ReceiptDetail,
  ReceiptSummary,
  TriageView,
} from "../../../shared/pa-views.js";
import {
  briefLabels,
  crmNote,
  GATE_LABELS,
  leadBriefSchema,
} from "../brief/index.js";
import { readFirstTouchClock, nextWorkingInstant } from "../clocks/index.js";
import {
  hubspotStage,
  latestLifecycle,
  movedOnOf,
  type HubSpotStage,
  type MovedOn,
} from "../crm/lifecycle.js";
import { currentAdvice } from "../decisions/index.js";
import {
  classOfSubmission,
  routeForEngagement,
} from "../lead-route/engagement.js";
import type { LeadRouteResult } from "../lead-route/index.js";
import {
  ENGAGEMENT_STATES,
  RELATIONSHIP_LABELS,
  VERDICT_LABELS,
  type RelationshipState,
  type Verdict,
} from "../objects/index.js";
import { profileHours } from "../pipeline/steps.js";
import { rule } from "../playbook/resolve.js";
import {
  playbookReleaseSchema,
  type Citation,
  type PlaybookRelease,
} from "../playbook/schema.js";
import type {
  OpenItem,
  PrecheckResult,
  SignalEvaluation,
} from "../precheck/index.js";
import { withReadCache } from "../repo/read-cache.js";
import type {
  EngagementRecord,
  PaRepository,
  PersonRecord,
  ReceiptRecord,
  UserProfileRecord,
} from "../repo/types.js";
import type { RoutingResult } from "../routing/index.js";
import type { ScorecardAnswer, ScorecardResult } from "../scorecard/index.js";
import {
  eventDetail,
  eventLabel,
  OWNER_SOURCE_LABELS,
  precheckLabel,
  RECEIPT_LABELS,
  routeLabel,
  stateLabel,
} from "./labels.js";
import { salesCycleView, slaView } from "./sla.js";
import { decisionView, draftSummary, draftView, triageFor } from "./triage.js";

const CLOCK_RANK: Record<ClockView["status"], number> = {
  breached: 0,
  at_risk: 1,
  running: 2,
  not_started: 3,
  met: 4,
  none: 5,
};

export interface Viewer {
  userId: string | null;
  canReplay: boolean;
}

function citationView(
  release: PlaybookRelease,
  citation: Citation,
): CitationView {
  const unconfirmed = release.pending_confirmation.some(
    (item) => item.entry_id === citation.id,
  );
  return {
    id: citation.id,
    version: citation.version,
    ...(unconfirmed ? { unconfirmed } : {}),
  };
}

function ownerView(
  profile: UserProfileRecord | undefined,
  viewer: Viewer,
  crmOwner: { email: string; displayName: string | null } | null = null,
): OwnerView | null {
  if (profile)
    return {
      id: profile.id,
      name: profile.displayName,
      email: profile.email,
      isMe: Boolean(viewer.userId && profile.userId === viewer.userId),
      inPa: true,
    };
  // The HubSpot owner routing chose, when they have no PA profile yet.
  if (crmOwner?.email)
    return {
      id: `crm:${crmOwner.email}`,
      name: crmOwner.displayName ?? crmOwner.email,
      email: crmOwner.email,
      isMe: Boolean(
        viewer.userId &&
        viewer.userId.toLowerCase() === crmOwner.email.toLowerCase(),
      ),
      inPa: false,
    };
  return null;
}

function clockView(input: {
  engagement: EngagementRecord;
  owner: UserProfileRecord | undefined;
  submittedAt: string;
  release: PlaybookRelease;
  now: Date;
  noClockReason: string | null;
}): ClockView {
  const sla = rule(input.release, "rule.sla.first_touch");
  const base = {
    reminderFraction: sla.params.reminder_at_fraction,
    ownerTimezone: input.owner?.timezone ?? null,
  };
  if (!input.engagement.firstTouchDueAt || !input.owner) {
    const reason = input.noClockReason ?? "No clock: no human owner";
    return {
      ...base,
      status: "none",
      summary: reason,
      reason,
      dueAt: null,
      startsAt: null,
      fraction: null,
      remainingMinutes: null,
      elapsedMinutes: null,
      totalMinutes: null,
    };
  }
  const hours = profileHours(input.owner);
  const startsAt = nextWorkingInstant(
    new Date(input.submittedAt),
    hours,
  ).toISOString();
  const reading = readFirstTouchClock({
    dueAt: input.engagement.firstTouchDueAt,
    startsAt,
    firstTouchAt: input.engagement.firstTouchAt,
    now: input.now,
    hours,
    totalMinutes: sla.params.minutes,
    reminderFraction: sla.params.reminder_at_fraction,
  });
  const summaries: Record<ClockView["status"], string> = {
    none: "No clock",
    not_started: `Starts at ${input.owner.displayName}'s next working hour`,
    running: `${reading.remainingMinutes} working minutes left`,
    at_risk: `At risk: ${reading.remainingMinutes} working minutes left`,
    breached: "Breached: first touch overdue",
    met: "First touch sent",
  };
  return {
    ...base,
    status: reading.status,
    summary: summaries[reading.status],
    reason: `${sla.params.minutes} working minutes in ${input.owner.displayName}'s hours (${sla.entry.id} v${sla.entry.version})`,
    dueAt: input.engagement.firstTouchDueAt,
    startsAt,
    fraction: reading.fraction,
    remainingMinutes: reading.remainingMinutes,
    elapsedMinutes: reading.elapsedMinutes,
    totalMinutes: reading.totalMinutes,
  };
}

async function noClockReason(repo: PaRepository, engagement: EngagementRecord) {
  if (engagement.firstTouchDueAt) return null;
  const events = await repo.listEvents(engagement.id);
  const event = [...events]
    .reverse()
    .find((item) => item.type === "clock.not_applicable");
  return event
    ? String(event.payload.reason ?? "No clock")
    : "No clock yet: not routed";
}

function excerpt(text: string | null, max = 140): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}...` : clean;
}

async function releaseFor(
  repo: PaRepository,
  id: string,
  current: PlaybookRelease,
): Promise<PlaybookRelease> {
  if (id === current.id) return current;
  const stored = await repo.getRelease(id);
  // Validated, not cast. This module also runs in the browser demo, so it
  // parses here instead of importing the server-only release store.
  return stored ? playbookReleaseSchema.parse(stored.content) : current;
}

const fieldOf = (fields: Record<string, unknown> | undefined, key: string) => {
  const value = fields?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const numberOf = (value: string | null) => {
  const parsed = value === null ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** "201-500" or "5,000+" to its lower bound, conservative for the 2,000 line. */
const lowerBound = (value: string | null) => {
  const match = value?.replace(/,/g, "").match(/\d+/);
  return match ? Number(match[0]) : null;
};

const detailSnapshotCompany = (snapshot: unknown) =>
  (
    snapshot as
      | {
          company?: {
            employees?: number | null;
            annualRevenue?: number | null;
          } | null;
        }
      | undefined
  )?.company ?? null;

async function briefView(
  repo: PaRepository,
  engagementId: string,
  context: { company: string | null; contact: string; source: string },
): Promise<EngagementDetail["brief"]> {
  const record = await repo.getLeadBrief(engagementId);
  if (!record) return null;
  const parsed = leadBriefSchema.safeParse(record.brief);
  if (!parsed.success) return null;
  const brief = parsed.data;
  return {
    persona: briefLabels.PERSONA[brief.persona],
    dealRole: briefLabels.ROLE[brief.deal_role],
    useCase: briefLabels.USE_CASE[brief.use_case],
    summary: brief.summary,
    v2Orientation: brief.v2_orientation ?? null,
    pathToEngineering: brief.path_to_engineering ?? null,
    enterpriseSignals: brief.enterprise_signals,
    gates: brief.gates.map((item) => ({
      gate: item.gate,
      label: GATE_LABELS[item.gate],
      status: item.status,
      evidence: item.evidence,
      nextMove: item.next_move ?? null,
    })),
    gapsRisks: brief.gaps_risks,
    nextStep: brief.next_step,
    crmNote: crmNote(brief, context),
    createdAt: record.createdAt,
  };
}

const FIXED_ROUTES = new Set([
  "no_sales_email",
  "customer_team",
  "deal_ae",
  "ae_owned",
  "partnerships",
  "partnership_recycle",
]);

function leadRouteView(route: LeadRouteResult): LeadRouteView {
  return {
    route: route.route,
    label: route.label,
    email: route.email,
    reason: route.reason,
    source: route.source,
    meetingWith: route.meetingWith,
    gaps: route.gaps,
    canOverride: !FIXED_ROUTES.has(route.route),
    paOwner: route.paOwner,
    segment: route.segment,
    needs: route.needs ?? null,
    roundRobin: route.roundRobin ?? null,
  };
}

async function leadRouteOf(
  repo: PaRepository,
  release: PlaybookRelease,
  engagement: EngagementRecord,
  triageKind: string,
  people?: PersonRecord[],
): Promise<LeadRouteView | null> {
  if (triageKind === "pending") return null;
  return leadRouteView(
    await routeForEngagement(repo, release, engagement, { people }),
  );
}

/**
 * The first email sent from HubSpot, as PA saved it when it found it (D75),
 * so the board shows it like a draft instead of "no draft needed".
 */
function sentSummary(
  events: Array<{ type: string; payload: Record<string, unknown> }>,
  engagement: EngagementRecord,
): DraftSummary | null {
  if (!engagement.firstTouchAt && engagement.state !== "first_touch_sent")
    return null;
  const saved = [...events]
    .reverse()
    .find(
      (item) =>
        item.type === "first_touch.email" ||
        item.type === "first_touch.detected",
    );
  if (!saved) return null;
  const text = (key: string) =>
    typeof saved.payload[key] === "string"
      ? (saved.payload[key] as string)
      : null;
  const thread = saved.payload.kind === "thread";
  return {
    status: "sent",
    subject: text("subject"),
    preview: text("preview"),
    problemCount: 0,
    note: thread
      ? "Contacted on a reply thread in HubSpot."
      : "The first email went out from HubSpot.",
  };
}

const AE_OWNED_NOTE =
  "No draft: owned by an AE in HubSpot, and HubSpot's workflow emails them.";

/** An AE owns the account (D80): PA steps back on the board and the record. */
function aeOwnedTriage(route: LeadRouteView): TriageView {
  return {
    kind: "elsewhere",
    label: "AE-owned account",
    verdictLabel: null,
    why: route.reason,
    action: "Nothing to do in PA. HubSpot's workflow emails them.",
  };
}

const PARTNERSHIP_RECYCLE_NOTE =
  "No draft: a partnership ask from a company that is not exceptional recycles.";

/** A partnership ask that is not exceptional (D81): recycle, no email. */
function partnershipRecycleTriage(route: LeadRouteView): TriageView {
  return {
    kind: "closed",
    label: "Partnership ask, recycle",
    verdictLabel: null,
    why: route.reason,
    action: "Decline and recycle it. No email goes out.",
  };
}

const SALES_KINDS = new Set(["reply", "review", "owner"]);

/** HubSpot moved the lead past PA (D90): it leaves the queue. */
function movedOnTriage(movedOn: MovedOn): TriageView {
  return {
    kind: "closed",
    label: "Actioned",
    verdictLabel: null,
    why: `${movedOn.reason}, so PA's part is done.`,
    action: "Nothing to do in PA. It continues in HubSpot.",
  };
}

/** How the board and record treat a route that needs no work from PA. */
function stepBackOf(
  route: LeadRouteView | null,
  movedOn: MovedOn | null = null,
) {
  if (movedOn)
    return {
      triage: movedOnTriage(movedOn),
      note: `No draft: ${movedOn.reason.charAt(0).toLowerCase()}${movedOn.reason.slice(1)}, so it is actioned.`,
      noClock: "No SLA: actioned in HubSpot",
      keepDecision: false,
      keepClock: true,
    };
  if (route?.route === "ae_owned")
    return {
      triage: aeOwnedTriage(route),
      note: AE_OWNED_NOTE,
      noClock: "No SLA: owned by an AE, HubSpot emails them",
      keepDecision: false,
      keepClock: false,
    };
  if (route?.route === "partnership_recycle")
    return {
      triage: partnershipRecycleTriage(route),
      note: PARTNERSHIP_RECYCLE_NOTE,
      noClock: "No SLA: a partnership ask that recycles",
      keepDecision: true,
      keepClock: false,
    };
  return null;
}

const untimed = (engagement: EngagementRecord): EngagementRecord => ({
  ...engagement,
  firstTouchDueAt: null,
  decisionDueAt: null,
});

async function liveDecision(
  repo: PaRepository,
  engagement: EngagementRecord,
  release: PlaybookRelease,
  now: Date,
  crmStage: HubSpotStage = null,
) {
  const record = await repo.getDecision(engagement.id);
  // HubSpot already moved the lead on (D83): the decision was made there.
  if (record?.status === "open" && crmStage) {
    const view = decisionView(record, now);
    if (!view) return null;
    const choice =
      crmStage === "sal"
        ? { code: "accept", label: "SAL in HubSpot" }
        : crmStage === "recycle"
          ? { code: "decline", label: "Recycled in HubSpot" }
          : { code: "disqualify", label: "Disqualified in HubSpot" };
    return {
      ...view,
      status: "decided" as const,
      overdue: false,
      choice,
      decidedBy: "HubSpot",
      decidedAt: null,
    };
  }
  const advice =
    record?.status === "open"
      ? await currentAdvice(repo, engagement, release)
      : null;
  return decisionView(record, now, advice);
}

function crmUrlOf(inbox: { payload: Record<string, unknown> } | null) {
  const url = inbox?.payload.crm_url;
  return typeof url === "string" && url.startsWith("https://app.hubspot.com/")
    ? url
    : null;
}

async function buildRow(
  repo: PaRepository,
  engagement: EngagementRecord,
  profiles: Map<string, UserProfileRecord>,
  viewer: Viewer,
  release: PlaybookRelease,
  now: Date,
  people: PersonRecord[],
): Promise<BoardRow & { hidden: boolean }> {
  const contact = await repo.getContact(engagement.contactId);
  const submissions = await repo.listSubmissionsForEngagement(engagement.id);
  const latest = submissions[submissions.length - 1];
  const assessment = latest
    ? await repo.getAssessmentForSubmission(latest.id)
    : null;
  const scorecards = await repo.listScorecards(engagement.id);
  const scorecard = scorecards[scorecards.length - 1];
  const events = await repo.listEvents(engagement.id);
  const lastEvent = [...events]
    .reverse()
    .find(
      (event) => !["pipeline.completed", "step.skipped"].includes(event.type),
    );
  const routeReceipt = latest
    ? await repo.findReceipt("route", latest.id)
    : null;
  const routing = routeReceipt?.ruleResults.routing as
    | RoutingResult
    | undefined;
  const owner = engagement.ownerUserId
    ? profiles.get(engagement.ownerUserId)
    : undefined;
  const email = contact?.email ?? latest?.email ?? "";
  const domain = email.slice(email.lastIndexOf("@") + 1);
  const pinned = await releaseFor(repo, engagement.playbookReleaseId, release);
  const precheckReceipt = latest
    ? await repo.findReceipt("precheck", latest.id)
    : null;
  const precheckOutcome =
    (precheckReceipt?.ruleResults.outcome as string | undefined) ?? null;
  const drafts = await repo.listDrafts(engagement.id);
  const leadName = contact?.name ?? latest?.name ?? null;
  const inbox = latest ? await repo.getInbox(latest.inboxId) : null;
  const ownerDisplay = ownerView(owner, viewer, routing?.owner ?? null);
  const snapshotReceipt = latest
    ? await repo.findReceipt("crm_snapshot", latest.id)
    : null;
  const hasOpenDeal =
    (
      (
        snapshotReceipt?.ruleResults.snapshot as
          | { openDeals?: unknown[] }
          | undefined
      )?.openDeals ?? []
    ).length > 0;
  const signal = (precheckReceipt?.ruleResults.signal as string | null) ?? null;
  const draft = draftView({
    engagement,
    precheckOutcome,
    signal,
    draft: drafts[drafts.length - 1] ?? null,
    lead: { name: leadName, email },
    ownerName: ownerDisplay?.name ?? null,
    cite: (citation) => citationView(pinned, citation),
    entryVersion: (id) =>
      pinned.entries.find((entry) => entry.id === id)?.version ?? null,
  });
  const qualification = precheckOutcome
    ? classOfSubmission({
        submission: latest,
        assessment,
        snapshot: snapshotReceipt?.ruleResults.snapshot as never,
        release,
      })
    : null;
  const triage = triageFor({
    engagement,
    precheckOutcome,
    signal,
    hasOpenDeal,
    qualification,
    intent: assessment?.intent ?? null,
    verdict: scorecard?.verdict ?? null,
    routeReason: engagement.routeReason,
    ownerName: ownerDisplay?.name ?? null,
    ownerIsMe: Boolean(ownerDisplay?.isMe),
    draftStatus: draft.status,
    awaitingAgent: !assessment && inbox?.source === "hubspot",
  });
  const submittedAt = latest?.submittedAt ?? engagement.createdAt;
  const leadRoute = await leadRouteOf(
    repo,
    release,
    engagement,
    triage.kind,
    people,
  );
  const snapshotLifecycle = (
    snapshotReceipt?.ruleResults.snapshot as
      | { contact?: { lifecycleRaw?: string | null } | null }
      | undefined
  )?.contact?.lifecycleRaw;
  const crmStage = hubspotStage(latestLifecycle(events, snapshotLifecycle));
  // Sales leads, and any lead PA already contacted (an open deal later).
  const movedOn: MovedOn | null =
    !SALES_KINDS.has(triage.kind) && !engagement.firstTouchAt
      ? null
      : (movedOnOf(events, snapshotLifecycle) ??
        (hasOpenDeal && engagement.firstTouchAt
          ? { reason: "A deal opened after PA's first touch", stage: "sal" }
          : null));
  const stepBack = stepBackOf(leadRoute, movedOn);
  const timed =
    stepBack && !stepBack.keepClock ? untimed(engagement) : engagement;
  const clock = clockView({
    engagement: timed,
    owner,
    submittedAt,
    release: pinned,
    now,
    noClockReason: stepBack
      ? stepBack.noClock
      : await noClockReason(repo, engagement),
  });
  const shownTriage = stepBack ? stepBack.triage : triage;
  const sent = sentSummary(events, engagement);
  const bucket: BoardRow["bucket"] = movedOn
    ? "moved_on"
    : shownTriage.kind === "closed" || shownTriage.kind === "elsewhere"
      ? "not_for_pa"
      : engagement.firstTouchAt || sent
        ? "contacted"
        : "todo";
  return {
    id: engagement.id,
    bucket,
    bucketReason:
      bucket === "moved_on"
        ? (movedOn?.reason ?? null)
        : bucket === "not_for_pa"
          ? shownTriage.label
          : null,
    triage: shownTriage,
    leadRoute: movedOn ? null : leadRoute,
    draft:
      sent ??
      (stepBack
        ? {
            status: "not_needed",
            subject: null,
            preview: null,
            problemCount: 0,
            note: stepBack.note,
          }
        : draftSummary(draft)),
    sla: slaView({
      engagement: timed,
      clock,
      events,
      submittedAt,
      now,
      crmStage,
    }),
    decision:
      stepBack && !stepBack.keepDecision
        ? null
        : await liveDecision(repo, engagement, release, now, crmStage),
    state: engagement.state,
    stateLabel: stateLabel(engagement.state),
    hidden: inbox?.status === "skipped",
    lead: {
      name: leadName,
      email,
      crmUrl: crmUrlOf(inbox),
      company: latest?.companyName ?? null,
      domain,
      personalDomain: engagement.accountId === null,
      country:
        typeof latest?.fields.country === "string"
          ? latest.fields.country
          : null,
    },
    asked: assessment?.explicitQuestion ?? excerpt(latest?.message ?? null),
    askedSource: assessment?.explicitQuestion
      ? "explicit_question"
      : latest?.message
        ? "message_excerpt"
        : null,
    route: {
      code: routing?.route ?? null,
      label: routeLabel(routing?.route ?? null),
      reason: engagement.routeReason,
    },
    owner: ownerDisplay,
    ownerSourceLabel: engagement.ownerSource
      ? (OWNER_SOURCE_LABELS[engagement.ownerSource] ?? engagement.ownerSource)
      : null,
    clock,
    verdict: scorecard
      ? {
          code: scorecard.verdict,
          label:
            VERDICT_LABELS[scorecard.verdict as Verdict] ?? scorecard.verdict,
          suggested: true,
        }
      : null,
    lastEvent: lastEvent
      ? {
          type: lastEvent.type,
          label: eventDetail(lastEvent) ?? eventLabel(lastEvent.type),
          at: lastEvent.occurredAt,
        }
      : null,
    flagged: engagement.reviewFlags.length > 0,
    submittedAt: latest?.submittedAt ?? engagement.createdAt,
  };
}

export function sortRows(rows: BoardRow[]): BoardRow[] {
  return [...rows].sort((a, b) => {
    const rank = CLOCK_RANK[a.sla.status] - CLOCK_RANK[b.sla.status];
    if (rank !== 0) return rank;
    const due = (row: BoardRow) =>
      row.sla.phase === "sal" ? row.sla.sal.dueAt : row.sla.contact.dueAt;
    const aDue = due(a);
    const bDue = due(b);
    if (aDue && bDue && aDue !== bDue) return aDue.localeCompare(bDue);
    return (
      b.submittedAt.localeCompare(a.submittedAt) || a.id.localeCompare(b.id)
    );
  });
}

export async function buildInboundBoard(input: {
  repo: PaRepository;
  release: PlaybookRelease;
  viewer: Viewer;
  tab: BoardTab;
  state: string | null;
  now: Date;
}): Promise<BoardResult> {
  input = { ...input, repo: withReadCache(input.repo) };
  const profiles = new Map(
    (await input.repo.listProfiles()).map((profile) => [profile.id, profile]),
  );
  const engagements = await input.repo.listEngagements();
  const people = await input.repo.listPeople();
  const rows: BoardRow[] = [];
  for (const engagement of engagements) {
    // A refresh closes the lead's earlier run (D63); those runs are never
    // shown, so skip them before any work (D84). Building them was most of
    // the board's database load.
    if (engagement.state === "closed" && engagement.outcome === "refreshed")
      continue;
    // So are leads the intake found were not Contact Sales; two cached reads
    // tell, instead of a whole row.
    const submissions = await input.repo.listSubmissionsForEngagement(
      engagement.id,
    );
    const latest = submissions[submissions.length - 1];
    const inbox = latest ? await input.repo.getInbox(latest.inboxId) : null;
    if (inbox?.status === "skipped") continue;
    const { hidden, ...row } = await buildRow(
      input.repo,
      engagement,
      profiles,
      input.viewer,
      input.release,
      input.now,
      people,
    );
    // Rows the intake found were not Contact Sales stay out of the board.
    if (!hidden) rows.push(row);
  }
  const counts: Record<BoardTab, number> = {
    mine: rows.filter((row) => row.owner?.isMe).length,
    team: rows.length,
    decide: rows.filter((row) => row.decision?.status === "open").length,
    at_risk: rows.filter((row) => row.sla.status === "at_risk").length,
    breached: rows.filter((row) => row.sla.status === "breached").length,
  };
  const byTab = rows.filter((row) => {
    if (input.tab === "mine") return Boolean(row.owner?.isMe);
    if (input.tab === "decide") return row.decision?.status === "open";
    if (input.tab === "at_risk") return row.sla.status === "at_risk";
    if (input.tab === "breached") return row.sla.status === "breached";
    return true;
  });
  const states = ENGAGEMENT_STATES.map((state) => ({
    state,
    label: stateLabel(state),
    count: byTab.filter((row) => row.state === state).length,
  })).filter((item) => item.count > 0);
  const filtered = input.state
    ? byTab.filter((row) => row.state === input.state)
    : byTab;
  const viewerProfile = input.viewer.userId
    ? [...profiles.values()].find(
        (profile) => profile.userId === input.viewer.userId,
      )
    : undefined;
  return {
    rows: sortRows(filtered),
    counts,
    states,
    total: rows.length,
    viewer: {
      profileName: viewerProfile?.displayName ?? null,
      canReplay: input.viewer.canReplay,
    },
    release: {
      id: input.release.id,
      shortId: input.release.short_id,
      pendingConfirmations: input.release.pending_confirmation.length,
    },
    mode: "shadow",
    generatedAt: input.now.toISOString(),
  };
}

function evaluations(items: SignalEvaluation[]): EvaluationView[] {
  return items.map((item) => ({
    name: item.signal,
    matched: item.matched,
    detail: item.basis,
  }));
}

function openItems(
  release: PlaybookRelease,
  items: OpenItem[],
): OpenItemView[] {
  return items.map((item) => ({
    code: item.code,
    detail: item.detail,
    entry: item.entry ? citationView(release, item.entry) : null,
  }));
}

function nextStepFor(input: {
  engagement: EngagementRecord;
  precheck: PrecheckResult | null;
  scorecard: ScorecardResult | null;
  agency: boolean;
  endClientNamed: boolean;
  hasQuestion: boolean;
  release: PlaybookRelease;
}): { text: string; entries: Citation[] } {
  const find = (id: string) =>
    input.release.entries.find((entry) => entry.id === id);
  const cite = (...ids: string[]) =>
    ids
      .map((id) => find(id))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .map((entry) => ({ id: entry.id, version: entry.version }));
  if (input.engagement.reviewFlags.length > 0) {
    return {
      text: "Review the flagged message before any outreach. Nothing in it was followed; the suggested verdict stays a suggestion.",
      entries: cite("def.recycle"),
    };
  }
  switch (input.engagement.state) {
    case "attached":
      if (input.agency && !input.endClientNamed) {
        return {
          text: "Answer their question and ask who the client is and what they want to build. No cold draft: the owner already has this relationship.",
          entries: cite("msg.agency.first_touch", "msg.first_touch.structure"),
        };
      }
      return {
        text: input.hasQuestion
          ? "The owner answers the new ask on the existing relationship. No cold draft."
          : "The owner follows up on the existing relationship. No cold draft.",
        entries: cite("msg.first_touch.structure", "rule.precheck.outcomes"),
      };
    case "awaiting_first_touch":
      return {
        text: input.hasQuestion
          ? "Send a first touch that answers their question first, with the calendar link as the one call to action."
          : "Send a first touch with the calendar link as the one call to action.",
        entries: cite("msg.first_touch.structure", "rule.sla.first_touch"),
      };
    case "closed":
      return {
        text:
          input.engagement.outcome === "routed_to_support"
            ? "Support owns this request. No sales action."
            : "Closed. No sales action.",
        entries: cite("rule.precheck.outcomes"),
      };
    case "disqualified":
      return {
        text:
          input.engagement.outcome === "self_serve_thank_you"
            ? "No sales action. The self-serve thank-you template ships in M2."
            : "No sales action. Logged for the weekly spot check.",
        entries: cite("rule.precheck.outcomes", "def.disqualify"),
      };
    default:
      return {
        text: "Waiting for the pipeline to finish routing this lead.",
        entries: [],
      };
  }
}

function answerView(answer: ScorecardAnswer): AnswerView {
  return {
    question: answer.question,
    label: answer.label,
    answer: answer.answer,
    known: answer.known,
    source: answer.source,
    asOf: answer.as_of,
    confidence: answer.confidence,
    conflicts: answer.conflicts ?? [],
  };
}

function receiptSummary(receipt: ReceiptRecord): string {
  const results = receipt.ruleResults as Record<string, any>;
  switch (receipt.kind) {
    case "normalize":
      return results.untrusted?.flagged
        ? `Identity resolved; message flagged (${results.untrusted.matches.length} matches)`
        : `Identity resolved; engagement ${results.engagement_action === "created" ? "created" : "attached"}`;
    case "crm_snapshot": {
      const snapshot = results.snapshot;
      const contact = snapshot?.contact;
      return contact
        ? `${snapshot.source}: ${contact.lifecycleRaw ?? "no lifecycle"}, owner ${contact.owner?.email ?? "none"}, ${snapshot.openDeals.length} open deals`
        : `${snapshot?.source ?? "crm"}: no contact found`;
    }
    case "assess_message":
    case "save_message_assessment":
      return `Validation ${results.validation}; source ${String(results.source ?? "agent").replace(/_/g, " ")}`;
    case "precheck":
      return `${precheckLabel(results.outcome)}${results.signal ? ` via ${String(results.signal).replace(/_/g, " ")}` : ""}`;
    case "route":
      return `${routeLabel(results.routing?.route ?? null)}${results.applied === false ? " (not applied)" : ""}`;
    case "draft":
      return results.needed === false
        ? String(results.reason ?? "No draft needed")
        : results.lint?.ok
          ? "Draft proposed; passes the message rules"
          : `Draft proposed; ${results.lint?.problems?.length ?? 0} lint problems`;
    case "score":
      return `Suggested verdict ${VERDICT_LABELS[results.verdict as Verdict] ?? results.verdict}`;
    default:
      return receipt.kind;
  }
}

export async function buildEngagementDetail(input: {
  repo: PaRepository;
  release: PlaybookRelease;
  viewer: Viewer;
  engagementId: string;
  now: Date;
}): Promise<EngagementDetail | null> {
  const repo = withReadCache(input.repo);
  const engagement = await repo.getEngagement(input.engagementId);
  if (!engagement) return null;
  const pinned = await releaseFor(
    repo,
    engagement.playbookReleaseId,
    input.release,
  );
  const profiles = new Map(
    (await repo.listProfiles()).map((profile) => [profile.id, profile]),
  );
  const owner = engagement.ownerUserId
    ? profiles.get(engagement.ownerUserId)
    : undefined;
  const contact = await repo.getContact(engagement.contactId);
  const submissions = await repo.listSubmissionsForEngagement(engagement.id);
  const latest = submissions[submissions.length - 1];
  const assessment = latest
    ? await repo.getAssessmentForSubmission(latest.id)
    : null;
  const receipts = await repo.listReceipts(engagement.id);
  const lastOf = (kind: string) =>
    [...receipts].reverse().find((receipt) => receipt.kind === kind);
  const precheckReceipt = lastOf("precheck");
  const routeReceipt = lastOf("route");
  const scoreReceipt = lastOf("score");
  const precheck = (precheckReceipt?.ruleResults ??
    null) as PrecheckResult | null;
  const routing = (routeReceipt?.ruleResults.routing ??
    null) as RoutingResult | null;
  const clocks = routeReceipt?.ruleResults.clocks as
    | { decision?: { applies: boolean; dueAt: string | null; reason: string } }
    | undefined;
  const scorecard = (scoreReceipt?.ruleResults ??
    null) as ScorecardResult | null;
  const scorecards = await repo.listScorecards(engagement.id);
  const events = await repo.listEvents(engagement.id);
  const email = contact?.email ?? latest?.email ?? "";
  const cv = (citation: Citation) => citationView(pinned, citation);
  const step = nextStepFor({
    engagement,
    precheck,
    scorecard,
    agency: Boolean(assessment?.agencySignal),
    endClientNamed: Boolean(assessment?.endClientNamed),
    hasQuestion: Boolean(assessment?.explicitQuestion),
    release: pinned,
  });

  const drafts = await repo.listDrafts(engagement.id);
  const ownerDisplay = ownerView(owner, input.viewer, routing?.owner ?? null);
  const inbox = latest ? await repo.getInbox(latest.inboxId) : null;
  const detailSnapshot = lastOf("crm_snapshot")?.ruleResults.snapshot as
    | { openDeals?: unknown[] }
    | undefined;
  const draft = draftView({
    engagement,
    precheckOutcome: precheck?.outcome ?? null,
    signal: precheck?.signal ?? null,
    draft: drafts[drafts.length - 1] ?? null,
    lead: { name: contact?.name ?? latest?.name ?? null, email },
    ownerName: ownerDisplay?.name ?? null,
    cite: cv,
    entryVersion: (id) =>
      pinned.entries.find((entry) => entry.id === id)?.version ?? null,
  });
  const triageRaw = triageFor({
    engagement,
    precheckOutcome: precheck?.outcome ?? null,
    signal: precheck?.signal ?? null,
    qualification: precheck?.outcome
      ? classOfSubmission({
          submission: latest,
          assessment,
          snapshot: detailSnapshot as never,
          release: input.release,
        })
      : null,
    hasOpenDeal: (detailSnapshot?.openDeals ?? []).length > 0,
    intent: assessment?.intent ?? null,
    verdict: scorecard?.verdict ?? null,
    routeReason: engagement.routeReason,
    ownerName: ownerDisplay?.name ?? null,
    ownerIsMe: Boolean(ownerDisplay?.isMe),
    draftStatus: draft.status,
    awaitingAgent: !assessment && inbox?.source === "hubspot",
  });

  const submittedAt = latest?.submittedAt ?? engagement.createdAt;
  const leadRoute = await leadRouteOf(
    repo,
    input.release,
    engagement,
    triageRaw.kind,
  );
  const snapshotLifecycle = (
    lastOf("crm_snapshot")?.ruleResults.snapshot as
      | { contact?: { lifecycleRaw?: string | null } | null }
      | undefined
  )?.contact?.lifecycleRaw;
  const crmLifecycle = latestLifecycle(events, snapshotLifecycle);
  const crmStage = hubspotStage(crmLifecycle);
  const movedOn: MovedOn | null =
    !SALES_KINDS.has(triageRaw.kind) && !engagement.firstTouchAt
      ? null
      : (movedOnOf(events, snapshotLifecycle) ??
        ((detailSnapshot?.openDeals ?? []).length > 0 && engagement.firstTouchAt
          ? { reason: "A deal opened after PA's first touch", stage: "sal" }
          : null));
  const stepBack = stepBackOf(leadRoute, movedOn);
  const triage = stepBack ? stepBack.triage : triageRaw;
  const timed =
    stepBack && !stepBack.keepClock ? untimed(engagement) : engagement;
  const clock = clockView({
    engagement: timed,
    owner,
    submittedAt,
    release: pinned,
    now: input.now,
    noClockReason: stepBack
      ? stepBack.noClock
      : await noClockReason(repo, engagement),
  });
  const snapshotReceipt = lastOf("crm_snapshot");
  const firstSubmission = submissions[0];

  return {
    id: engagement.id,
    triage,
    leadRoute: movedOn ? null : leadRoute,
    draft: stepBack
      ? {
          ...draft,
          status: "not_needed",
          id: null,
          body: null,
          subject: null,
          preview: null,
          problems: [],
          problemCount: 0,
          cc: null,
          rubric: null,
          reasoning: null,
          note: stepBack.note,
        }
      : {
          ...draft,
          // Asked to rewrite after the latest draft (D87): show it is coming.
          rewriting: events.some(
            (item) =>
              item.type === "draft.rewrite_requested" &&
              item.occurredAt > (draft.createdAt ?? ""),
          ),
        },
    sla: slaView({
      engagement: timed,
      clock,
      events,
      submittedAt,
      now: input.now,
      crmStage,
    }),
    decision:
      stepBack && !stepBack.keepDecision
        ? null
        : await liveDecision(
            repo,
            engagement,
            input.release,
            input.now,
            crmStage,
          ),
    brief: await briefView(repo, engagement.id, {
      company: latest?.companyName ?? null,
      contact: [
        contact?.name ?? latest?.name,
        fieldOf(latest?.fields, "job_title"),
      ]
        .filter(Boolean)
        .join(", "),
      source: "Contact Sales",
    }),
    contactSalesClass:
      triage.kind === "reply" || triage.kind === "review"
        ? classOfSubmission({
            submission: latest,
            assessment,
            snapshot: detailSnapshot as never,
            release: input.release,
          })
        : null,
    salesCycle: salesCycleView({
      submittedAt: firstSubmission?.submittedAt ?? engagement.createdAt,
      verdict: scorecard?.verdict ?? null,
      scoredAt: scorecards[scorecards.length - 1]?.createdAt ?? null,
      crmLifecycle,
      // The lead's own kind: a moved-on sales lead still reached QL (D91).
      triageKind: triageRaw.kind,
      events,
      decisionChoice: (await repo.getDecision(engagement.id))?.choice ?? null,
    }),
    state: engagement.state,
    stateLabel: stateLabel(engagement.state),
    mode: engagement.mode,
    createdAt: engagement.createdAt,
    lead: {
      name: contact?.name ?? latest?.name ?? null,
      email,
      crmUrl: crmUrlOf(inbox),
      company: latest?.companyName ?? null,
      domain: email.slice(email.lastIndexOf("@") + 1),
      personalDomain: engagement.accountId === null,
      country:
        typeof latest?.fields.country === "string"
          ? latest.fields.country
          : null,
    },
    owner: ownerDisplay,
    ownerSourceLabel: engagement.ownerSource
      ? (OWNER_SOURCE_LABELS[engagement.ownerSource] ?? engagement.ownerSource)
      : null,
    relationship: {
      code: engagement.relationshipState,
      label: engagement.relationshipState
        ? (RELATIONSHIP_LABELS[
            engagement.relationshipState as RelationshipState
          ] ?? engagement.relationshipState)
        : null,
    },
    clock,
    decisionClock: {
      applies: Boolean(clocks?.decision?.applies),
      dueAt: clocks?.decision?.dueAt ?? null,
      reason: clocks?.decision?.reason ?? "No decision clock",
    },
    release: {
      id: pinned.id,
      shortId: pinned.short_id,
      isCurrent: pinned.id === input.release.id,
    },
    flags: engagement.reviewFlags.map((flag) => ({
      code: flag.code,
      detail: flag.detail,
      at: flag.at,
    })),
    submissions: submissions.map((submission) => ({
      id: submission.id,
      submittedAt: submission.submittedAt,
      message: submission.message,
      flags: submission.flags,
    })),
    assessment: assessment
      ? {
          id: assessment.id,
          intent: assessment.intent,
          agencySignal: assessment.agencySignal,
          endClientNamed: assessment.endClientNamed,
          productInterest: assessment.productInterest,
          language: assessment.language,
          explicitQuestion: assessment.explicitQuestion,
          evidenceQuotes: assessment.evidenceQuotes,
          source: assessment.source,
          createdAt: assessment.createdAt,
        }
      : null,
    nextStep: { text: step.text, entries: step.entries.map(cv) },
    precheck: precheck
      ? {
          outcome: precheck.outcome,
          outcomeLabel: precheckLabel(precheck.outcome),
          signal: precheck.signal,
          evaluated: evaluations(precheck.evaluated),
          openItems: openItems(pinned, precheck.openItems),
          entries: precheck.citations.map(cv),
        }
      : null,
    route: routing
      ? {
          code: routing.route,
          label: routeLabel(routing.route),
          reason: routing.reason,
          evaluated: routing.evaluated.map((item) => ({
            name: item.step,
            matched: item.matched,
            detail: item.detail,
          })),
          openItems: openItems(pinned, routing.openItems),
          entries: (routeReceipt?.entryVersions ?? routing.citations).map(cv),
          poolSource: routing.pool.source,
        }
      : null,
    scorecard: scorecard
      ? {
          verdict: scorecard.verdict,
          verdictLabel: VERDICT_LABELS[scorecard.verdict] ?? scorecard.verdict,
          version: scorecards[scorecards.length - 1]?.version ?? 1,
          reasonCodes: scorecard.reasonCodes.map((reason) => ({
            code: reason.code,
            detail: reason.detail,
            entry: cv(reason.entry),
          })),
          answers: scorecard.answers.map(answerView),
          hypothesis: scorecard.hypothesis
            ? {
                entity: scorecard.hypothesis.entity,
                statement: scorecard.hypothesis.statement,
                entry: cv(scorecard.hypothesis.entry),
              }
            : null,
          notes: scorecard.notes,
        }
      : null,
    timeline: events
      .filter((event) => event.type !== "pipeline.completed")
      .map((event) => ({
        id: event.id,
        type: event.type,
        label: eventLabel(event.type),
        detail: eventDetail(event),
        actor: event.actor,
        at: event.occurredAt,
        receiptId: event.receiptId,
      })),
    receipts: receipts.map(
      (receipt): ReceiptSummary => ({
        id: receipt.id,
        kind: receipt.kind,
        label: RECEIPT_LABELS[receipt.kind] ?? receipt.kind,
        createdAt: receipt.createdAt,
        entries: receipt.entryVersions.map(cv),
        summary: receiptSummary(receipt),
      }),
    ),
  };
}

export async function buildReceiptDetail(input: {
  repo: PaRepository;
  release: PlaybookRelease;
  receiptId: string;
}): Promise<ReceiptDetail | null> {
  const receipt = await input.repo.getReceipt(input.receiptId);
  if (!receipt) return null;
  const pinned = await releaseFor(
    input.repo,
    receipt.playbookReleaseId,
    input.release,
  );
  return {
    id: receipt.id,
    kind: receipt.kind,
    label: RECEIPT_LABELS[receipt.kind] ?? receipt.kind,
    engagementId: receipt.engagementId,
    submissionId: receipt.submissionId,
    createdAt: receipt.createdAt,
    release: { id: pinned.id, shortId: pinned.short_id },
    entries: receipt.entryVersions.map((citation) =>
      citationView(pinned, citation),
    ),
    ruleResults: receipt.ruleResults,
    inputs: receipt.inputs,
    agentRunId: receipt.agentRunId,
    model: receipt.model,
  };
}
