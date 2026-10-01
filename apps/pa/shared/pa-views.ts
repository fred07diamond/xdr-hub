export type ClockStatus =
  | "none"
  | "not_started"
  | "running"
  | "at_risk"
  | "breached"
  | "met";

export interface CitationView {
  id: string;
  version: number;
  unconfirmed?: boolean;
}

export interface ClockView {
  status: ClockStatus;
  summary: string;
  reason: string;
  dueAt: string | null;
  startsAt: string | null;
  fraction: number | null;
  reminderFraction: number;
  remainingMinutes: number | null;
  elapsedMinutes: number | null;
  totalMinutes: number | null;
  ownerTimezone: string | null;
}

/**
 * The SLA timer (D51): two milestones, not a triage clock. Triage is automatic;
 * the timer measures how fast a person contacts the lead, then how fast the
 * owner decides SAL. `phase` is the milestone the timer is on now.
 */
export type SlaPhase = "contact" | "sal" | "done" | "none";

export interface SlaMilestone {
  applies: boolean;
  status: ClockStatus;
  dueAt: string | null;
  doneAt: string | null;
  label: string;
}

export interface SlaView {
  phase: SlaPhase;
  status: ClockStatus;
  label: string;
  detail: string;
  contact: SlaMilestone;
  sal: SlaMilestone;
  /** How much of the current milestone's time is used, for the rail. */
  fraction: number | null;
  reminderFraction: number;
}

export const SALES_STAGES = [
  { code: "mql", label: "MQL" },
  { code: "ql", label: "QL" },
  { code: "sal", label: "SAL" },
  { code: "s0", label: "S0" },
  { code: "nbm_booked", label: "NBM booked" },
  { code: "nbm_complete", label: "NBM complete" },
  { code: "s1", label: "S1" },
] as const;
export type SalesStageCode = (typeof SALES_STAGES)[number]["code"];

export interface SalesStageView {
  code: SalesStageCode;
  label: string;
  status: "done" | "current" | "upcoming" | "stopped";
  at: string | null;
  note: string | null;
}

export interface LeadView {
  name: string | null;
  email: string;
  /** The contact's HubSpot record, for live leads. */
  crmUrl: string | null;
  company: string | null;
  domain: string;
  personalDomain: boolean;
  country: string | null;
}

export interface OwnerView {
  id: string;
  name: string;
  email: string;
  isMe: boolean;
  /** False for a HubSpot owner who has no PA profile yet (no SLA timer). */
  inPa: boolean;
}

/**
 * How the lead was classified, in one glance: what kind of lead it is, why,
 * and what the PA does next. `kind` drives the tone:
 * reply (a first touch is due), review (check before replying), owner (an
 * existing owner picks it up), elsewhere (support), closed (no reply), and
 * pending (still being triaged).
 */
export type TriageKind =
  | "reply"
  | "review"
  | "owner"
  | "elsewhere"
  | "closed"
  | "pending";

export interface TriageView {
  kind: TriageKind;
  label: string;
  verdictLabel: string | null;
  why: string;
  action: string;
}

/** After triage, who takes the meeting (D66). */
export interface LeadRouteView {
  route: string;
  label: string;
  /** What the email does on this route. */
  email: string;
  reason: string;
  source: "playbook" | "override" | "crm";
  meetingWith: {
    email: string;
    name: string | null;
    role: "ae" | "pa" | "partnerships";
    link: string | null;
  } | null;
  gaps: string[];
  /** Whether the PA can change it on this lead. */
  canOverride: boolean;
  /** The lead's PA. */
  paOwner: { email: string; name: string | null } | null;
  /** Commercial or enterprise, from the company's employees (D77). */
  segment: "commercial" | "enterprise" | null;
  /** Who is missing to finish the route, so the lead page asks once. */
  needs: "commercial_ae" | "enterprise_ae" | "partnerships" | null;
  /** The enterprise round robin: given and saved, or next up (D78). */
  roundRobin: "assigned" | "pending" | null;
}

export type DraftStatus =
  | "ready"
  | "needs_edit"
  | "waiting"
  | "not_needed"
  /** The first email already went out from HubSpot (D75). */
  | "sent";

export interface DraftSummary {
  status: DraftStatus;
  subject: string | null;
  preview: string | null;
  problemCount: number;
  /** Why there is no draft, or what state it is in, in plain words. */
  note: string;
}

export interface DraftView extends DraftSummary {
  id: string | null;
  /** The AE looped in on the email for an exceptional lead (D72). */
  cc: string | null;
  /** The TCQ parts and why the agent wrote it this way (D85). */
  rubric: { trigger: string; connection: string; ask: string } | null;
  reasoning: {
    approach: string;
    acknowledgment?: string;
    trigger: string;
    connection: string;
    question: string;
    asks: Array<{ asked: string; answer: string }>;
    tone: string;
  } | null;
  body: string | null;
  cta: { code: string; label: string } | null;
  /** The Contact Sales class the draft was written for (Sales handbook 03). */
  approach: { code: string; label: string } | null;
  warnings: Array<{ code: string; message: string }>;
  language: string | null;
  to: { name: string | null; email: string };
  from: string | null;
  problems: Array<{ code: string; message: string }>;
  notChecked: string[];
  checksRun: number;
  wordCount: number | null;
  usedEntries: CitationView[];
  source: string | null;
  createdAt: string | null;
}

export interface BoardRow {
  id: string;
  state: string;
  stateLabel: string;
  lead: LeadView;
  asked: string | null;
  askedSource: "explicit_question" | "message_excerpt" | null;
  route: { code: string | null; label: string; reason: string | null };
  owner: OwnerView | null;
  ownerSourceLabel: string | null;
  clock: ClockView;
  verdict: { code: string; label: string; suggested: true } | null;
  lastEvent: { type: string; label: string; at: string } | null;
  flagged: boolean;
  submittedAt: string;
  triage: TriageView;
  leadRoute: LeadRouteView | null;
  draft: DraftSummary;
  sla: SlaView;
  decision: DecisionView | null;
}

export type BoardTab = "mine" | "team" | "decide" | "at_risk" | "breached";

/** The rep's decision on a lead (workflow 2b, D59). */
export interface DecisionView {
  status: "open" | "decided";
  kind: "standard" | "meeting_booked";
  options: Array<{ code: string; label: string }>;
  recommendation: { code: string; label: string };
  reason: string;
  question: string | null;
  dueAt: string;
  overdue: boolean;
  slaMissedAt: string | null;
  choice: { code: string; label: string } | null;
  note: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface BoardResult {
  rows: BoardRow[];
  counts: Record<BoardTab, number>;
  states: Array<{ state: string; label: string; count: number }>;
  total: number;
  viewer: { profileName: string | null; canReplay: boolean };
  release: { id: string; shortId: string; pendingConfirmations: number };
  mode: "shadow";
  generatedAt: string;
}

export interface EvaluationView {
  name: string;
  matched: boolean | null;
  detail: string;
}

export interface OpenItemView {
  code: string;
  detail: string;
  entry: CitationView | null;
}

export interface AnswerView {
  question: string;
  label: string;
  answer: string;
  known: boolean;
  source: { kind: string; ref: string; quote?: string } | null;
  asOf: string | null;
  confidence: string | null;
  conflicts: Array<{ source: { kind: string; ref: string }; value: string }>;
}

export interface TimelineItem {
  id: string;
  type: string;
  label: string;
  detail: string | null;
  actor: string;
  at: string;
  receiptId: string | null;
}

export interface ReceiptSummary {
  id: string;
  kind: string;
  label: string;
  createdAt: string;
  entries: CitationView[];
  summary: string;
}

export interface EngagementDetail {
  id: string;
  state: string;
  stateLabel: string;
  mode: string;
  createdAt: string;
  lead: LeadView;
  owner: OwnerView | null;
  ownerSourceLabel: string | null;
  relationship: { code: string | null; label: string | null };
  clock: ClockView;
  decisionClock: { applies: boolean; dueAt: string | null; reason: string };
  release: { id: string; shortId: string; isCurrent: boolean };
  flags: Array<{ code: string; detail: string; at: string }>;
  submissions: Array<{
    id: string;
    submittedAt: string;
    message: string | null;
    flags: Array<{ pattern: string; text: string }>;
  }>;
  assessment: {
    id: string;
    intent: string;
    agencySignal: boolean;
    endClientNamed: boolean;
    productInterest: string;
    language: string;
    explicitQuestion: string | null;
    evidenceQuotes: string[];
    source: string;
    createdAt: string;
  } | null;
  nextStep: { text: string; entries: CitationView[] };
  precheck: {
    outcome: string;
    outcomeLabel: string;
    signal: string | null;
    evaluated: EvaluationView[];
    openItems: OpenItemView[];
    entries: CitationView[];
  } | null;
  route: {
    code: string;
    label: string;
    reason: string;
    evaluated: EvaluationView[];
    openItems: OpenItemView[];
    entries: CitationView[];
    poolSource: string;
  } | null;
  scorecard: {
    verdict: string;
    verdictLabel: string;
    version: number;
    reasonCodes: Array<{ code: string; detail: string; entry: CitationView }>;
    answers: AnswerView[];
    hypothesis: {
      entity: string;
      statement: string;
      entry: CitationView;
    } | null;
    notes: string[];
  } | null;
  triage: TriageView;
  leadRoute: LeadRouteView | null;
  draft: DraftView;
  sla: SlaView;
  decision: DecisionView | null;
  salesCycle: SalesStageView[];
  /** The agent's lead brief (D61), with the CRM note formatted for pasting. */
  brief: {
    persona: string;
    dealRole: string;
    useCase: string;
    summary: string;
    v2Orientation: string | null;
    pathToEngineering: string | null;
    enterpriseSignals: string[];
    gates: Array<{
      gate: string;
      label: string;
      status: "met" | "gap" | "unknown";
      evidence: string;
      nextMove: string | null;
    }>;
    gapsRisks: string[];
    nextStep: string;
    crmNote: string;
    createdAt: string;
  } | null;
  /** The Contact Sales class PA suggests, with the criteria behind it (D61). */
  contactSalesClass: {
    approach: string;
    label: string;
    product: "content" | "code";
    /** Exceptional routes to the AE; discovery is qualified first (D67). */
    tier?: "exceptional" | "discovery" | null;
    suggestRecycle?: boolean;
    signalsMet?: number;
    criteria: Array<{ label: string; met: boolean | null; evidence: string }>;
    summary: string;
  } | null;
  timeline: TimelineItem[];
  receipts: ReceiptSummary[];
}

export interface ReceiptDetail {
  id: string;
  kind: string;
  label: string;
  engagementId: string | null;
  submissionId: string | null;
  createdAt: string;
  release: { id: string; shortId: string };
  entries: CitationView[];
  ruleResults: unknown;
  inputs: unknown;
  agentRunId: string | null;
  model: string | null;
}
