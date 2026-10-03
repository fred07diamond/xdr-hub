import type { Citation } from "../playbook/schema.js";

export type InboxStatus =
  | "pending"
  | "processing"
  | "done"
  | "failed"
  | "skipped"
  /** Queued to be re-read from HubSpot and re-run (D63). */
  | "refresh";

export interface InboxRecord {
  id: string;
  source: string;
  externalId: string;
  receivedAt: string;
  signatureOk: boolean;
  payload: Record<string, unknown>;
  status: InboxStatus;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SubmissionFlag {
  pattern: string;
  text: string;
}

export interface SubmissionRecord {
  id: string;
  inboxId: string;
  engagementId: string | null;
  formId: string | null;
  submittedAt: string;
  email: string;
  name: string | null;
  companyName: string | null;
  message: string | null;
  fields: Record<string, unknown>;
  flags: SubmissionFlag[];
  crmContactRef: string | null;
  pageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountRecord {
  id: string;
  domain: string;
  name: string | null;
  crmCompanyRef: string | null;
  flags: Record<string, { value: boolean; setBy: string; setAt: string }>;
  firmographics: Record<string, unknown> | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContactRecord {
  id: string;
  email: string;
  name: string | null;
  title: string | null;
  accountId: string | null;
  crmContactRef: string | null;
  language: string | null;
  optOut: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewFlag {
  code: string;
  detail: string;
  submissionId: string;
  at: string;
}

export interface EngagementRecord {
  id: string;
  accountId: string | null;
  contactId: string;
  motion: string;
  state: string;
  ownerUserId: string | null;
  ownerSource: string | null;
  routeReason: string | null;
  relationshipState: string | null;
  firstTouchDueAt: string | null;
  decisionDueAt: string | null;
  firstTouchAt: string | null;
  outcome: string | null;
  attachedToId: string | null;
  playbookReleaseId: string;
  mode: string;
  reviewFlags: ReviewFlag[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface EventRecord {
  id: string;
  engagementId: string | null;
  correlationId: string;
  type: string;
  actor: string;
  payload: Record<string, unknown>;
  receiptId: string | null;
  occurredAt: string;
}

export interface AssessmentRecord {
  id: string;
  engagementId: string;
  submissionId: string;
  intent: string;
  agencySignal: boolean;
  evidenceQuotes: string[];
  endClientNamed: boolean;
  productInterest: string;
  language: string;
  explicitQuestion: string | null;
  source: string;
  receiptId: string | null;
  createdAt: string;
}

export interface ScorecardRecord {
  id: string;
  engagementId: string;
  submissionId: string | null;
  version: number;
  verdict: string;
  reasonCodes: unknown[];
  answers: unknown[];
  hypothesis: Record<string, unknown> | null;
  receiptId: string | null;
  createdAt: string;
}

export interface DraftRecord {
  id: string;
  engagementId: string;
  submissionId: string | null;
  subject: string;
  body: string;
  /** The one call to action: meeting, reply, or trial. */
  cta: string;
  language: string;
  status: string;
  usedEntryIds: string[];
  lint: Record<string, unknown> | null;
  /** Who wrote it: agent, or the fixture drafter in replay and demo. */
  source: string;
  receiptId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionRecord {
  id: string;
  engagementId: string;
  /** standard: accept, decline, research. meeting_booked: what to do with the meeting. */
  kind: "standard" | "meeting_booked";
  options: string[];
  recommendation: string;
  recommendationReason: string;
  /** A question flagged for the rep, when PA cannot tell (workflow 1b). */
  question: string | null;
  ownerEmail: string | null;
  dueAt: string;
  status: "open" | "decided";
  choice: string | null;
  note: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  slaMissedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface LeadBriefRecord {
  id: string;
  engagementId: string;
  brief: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
}

export type FollowUpStatus =
  | "scheduled"
  | "drafted"
  | "needs_edit"
  /** A template step the rep approved at enrollment; sends on its day (D105). */
  | "approved"
  | "sent"
  | "stopped";

/** One follow-up of a lead's cadence (D101): due on a day, written by the agent. */
export interface FollowUpRecord {
  id: string;
  engagementId: string;
  route: string;
  /** 1 for the first follow-up after the first touch. */
  stepIndex: number;
  day: number;
  purpose: string;
  dueAt: string;
  status: FollowUpStatus;
  subject: string | null;
  body: string | null;
  lint: Record<string, unknown> | null;
  cc: string | null;
  stopReason: string | null;
  sentAt: string | null;
  gmailId: string | null;
  editedBy: string | null;
  /** "reply" in the first touch's thread (default), or "new" (D104). */
  thread?: "reply" | "new" | null;
  /** The sequence it came from (D105); null for the old route cadences. */
  sequenceId?: string | null;
  /** Who approved it at enrollment, and sends it (template steps, D105). */
  approvedBy?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** A named sequence (D105). */
export interface SequenceRecord {
  id: string;
  name: string;
  kind: "dynamic" | "template";
  description: string;
  recommendedFor: string[];
  steps: Array<{
    id: string;
    day: number;
    thread: "reply" | "new";
    cc_ae: boolean;
    purpose: string;
    subject: string;
    body: string;
  }>;
  createdBy: string;
  updatedBy: string;
  archived: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * One email PA sends or saves through the owner's Gmail (D96). The unique
 * idempotency key is what stops a lead being sent twice.
 */
export interface OutboxRecord {
  id: string;
  /** gmail_send: sent from the owner's Gmail. gmail_draft: saved to their Gmail Drafts. */
  kind: "gmail_send" | "gmail_draft";
  idempotencyKey: string;
  engagementId: string | null;
  payload: Record<string, unknown>;
  /** pending: handed to Gmail, answer not back yet. failed: Gmail refused it; safe to retry. */
  status: "pending" | "sent" | "failed";
  attempts: number;
  nextAttemptAt: string | null;
  /** Gmail's message or draft id. */
  providerRef: string | null;
  lastError: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type PersonRole = "pa" | "ae" | "commercial_ae" | "partnerships" | "csm";

/** An enterprise AE given to a lead by round robin (D78). */
export interface AeAssignmentRecord {
  engagementId: string;
  aeEmail: string;
  /** carried: copied onto the lead's new run by a refresh; not counted again. */
  method: "round_robin" | "carried";
  assignedAt: string;
}

/** Someone a lead can be routed to (D66): role and meeting link. podAeEmail is no longer used for routing (D78). */
export interface PersonRecord {
  email: string;
  displayName: string | null;
  role: PersonRole | null;
  meetingLink: string | null;
  /** For a PA: the AE their enterprise leads go to when the account has none. */
  podAeEmail: string | null;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

/** A PA's override of the playbook's route for one lead. */
export interface RouteOverrideRecord {
  engagementId: string;
  route: string;
  note: string | null;
  setBy: string;
  setAt: string;
}

export type HandbookStatus = "index" | "current" | "legacy";

export interface HandbookDocRecord {
  id: string;
  title: string;
  summary: string | null;
  body: string;
  position: number;
  status: HandbookStatus;
  source: string | null;
  version: number;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface HandbookRevisionRecord {
  id: string;
  docId: string;
  version: number;
  title: string;
  body: string;
  editedBy: string;
  note: string | null;
  createdAt: string;
}

export interface ReceiptRecord {
  id: string;
  kind: string;
  engagementId: string | null;
  submissionId: string | null;
  playbookReleaseId: string;
  entryVersions: Citation[];
  ruleResults: Record<string, unknown>;
  inputs: Record<string, unknown>;
  agentRunId: string | null;
  toolCalls: unknown[] | null;
  model: string | null;
  createdAt: string;
}

export interface ReleaseRecord {
  id: string;
  shortId: string;
  entries: unknown[];
  content: Record<string, unknown>;
  label: string;
  createdAt: string;
}

export interface WorkingHoursRecord {
  days: number[];
  start: string;
  end: string;
}

export interface UserProfileRecord {
  id: string;
  userId: string | null;
  email: string;
  displayName: string;
  slackUserId: string | null;
  crmOwnerId: string | null;
  timezone: string;
  workingHours: WorkingHoursRecord;
  roles: string[];
  inRoundRobin: boolean;
  isDesignPartner: boolean;
  isSynthetic: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export class VersionConflictError extends Error {}

// Dynamic playbook (D44).
export interface ReleaseLabelRecord {
  label: string;
  releaseId: string;
  movedBy: string;
  movedAt: string;
  version: number;
}

export const CHANGE_STATUSES = [
  "draft",
  "in_review",
  "published",
  "rejected",
  "withdrawn",
] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

export interface ChangeRecord {
  id: string;
  title: string;
  rationale: string;
  authorEmail: string;
  /** "agent" when drafted by the agent; people still review and publish. */
  authorKind: "user" | "agent";
  status: ChangeStatus;
  baseReleaseId: string;
  resultReleaseId: string | null;
  requiredTeams: string[];
  checks: Record<string, unknown> | null;
  impact: Record<string, unknown> | null;
  checkedAgainst: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type ChangeItemOp = "add" | "update" | "retire" | "set_config";

export interface ChangeItemRecord {
  id: string;
  changeId: string;
  target: string;
  op: ChangeItemOp;
  beforeValue: unknown;
  afterValue: unknown;
  ownerTeam: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRecord {
  id: string;
  changeId: string;
  team: string;
  reviewerEmail: string;
  decision: "approve" | "reject";
  note: string | null;
  /** The app owner approving for a team that has no members yet. */
  onBehalf: boolean;
  /** The item fingerprint approved; an edit afterwards voids the approval. */
  checkedAgainst: string;
  createdAt: string;
}

export const SUGGESTION_KINDS = [
  "feature",
  "crm_field",
  "view",
  "playbook",
  "knowledge",
] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];
export const SUGGESTION_AUDIENCES = ["app_owner", "revops", "pa_team"] as const;
export type SuggestionAudience = (typeof SUGGESTION_AUDIENCES)[number];
export const SUGGESTION_STATUSES = [
  "open",
  "accepted",
  "dismissed",
  "done",
] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export interface SuggestionRecord {
  id: string;
  kind: SuggestionKind;
  audience: SuggestionAudience;
  title: string;
  body: string;
  evidence: Record<string, unknown>;
  source: "check" | "agent";
  releaseId: string | null;
  changeId: string | null;
  dedupeKey: string;
  status: SuggestionStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  notifiedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlaybookStore {
  listReleases(limit: number): Promise<ReleaseRecord[]>;
  getLabel(label: string): Promise<ReleaseLabelRecord | null>;
  /** Creates the label if absent; returns the stored label either way. */
  createLabelIfAbsent(record: ReleaseLabelRecord): Promise<ReleaseLabelRecord>;
  /** Compare-and-set on the label version. */
  moveLabel(
    label: string,
    patch: { releaseId: string; movedBy: string; movedAt: string },
    expectedVersion: number,
  ): Promise<ReleaseLabelRecord>;

  insertChange(record: ChangeRecord): Promise<void>;
  getChange(id: string): Promise<ChangeRecord | null>;
  listChanges(filter: {
    statuses?: ChangeStatus[];
    limit: number;
  }): Promise<ChangeRecord[]>;
  updateChange(
    id: string,
    patch: Partial<ChangeRecord>,
    expectedVersion: number,
  ): Promise<ChangeRecord>;

  upsertChangeItem(record: ChangeItemRecord): Promise<ChangeItemRecord>;
  deleteChangeItem(changeId: string, target: string): Promise<void>;
  listChangeItems(changeId: string): Promise<ChangeItemRecord[]>;

  insertApproval(record: ApprovalRecord): Promise<void>;
  listApprovals(changeId: string): Promise<ApprovalRecord[]>;

  /** Deduped on dedupeKey: returns the existing row when one exists. */
  recordSuggestion(
    record: SuggestionRecord,
  ): Promise<{ record: SuggestionRecord; inserted: boolean }>;
  getSuggestion(id: string): Promise<SuggestionRecord | null>;
  listSuggestions(filter: {
    audiences?: SuggestionAudience[];
    statuses?: SuggestionStatus[];
    limit: number;
  }): Promise<SuggestionRecord[]>;
  updateSuggestion(
    id: string,
    patch: Partial<SuggestionRecord>,
    expectedVersion: number,
  ): Promise<SuggestionRecord>;
}

export interface PaRepository extends PlaybookStore {
  transaction<T>(work: (repo: PaRepository) => Promise<T>): Promise<T>;

  insertInboxIfAbsent(
    record: InboxRecord,
  ): Promise<{ record: InboxRecord; inserted: boolean }>;
  getInbox(id: string): Promise<InboxRecord | null>;
  getInboxBySource(
    source: string,
    externalId: string,
  ): Promise<InboxRecord | null>;
  updateInbox(
    id: string,
    patch: Partial<InboxRecord>,
    expectedVersion: number,
  ): Promise<InboxRecord>;
  /** Oldest first: rows from one source in the given statuses. */
  listInboxBySource(
    source: string,
    statuses: InboxStatus[],
    limit: number,
  ): Promise<InboxRecord[]>;

  insertSubmission(record: SubmissionRecord): Promise<void>;
  getSubmission(id: string): Promise<SubmissionRecord | null>;
  getSubmissionByInbox(inboxId: string): Promise<SubmissionRecord | null>;
  listSubmissionsForEngagement(
    engagementId: string,
  ): Promise<SubmissionRecord[]>;
  setSubmissionEngagement(
    id: string,
    engagementId: string,
    updatedAt: string,
  ): Promise<void>;

  getAccountByDomain(domain: string): Promise<AccountRecord | null>;
  getAccount(id: string): Promise<AccountRecord | null>;
  insertAccount(record: AccountRecord): Promise<void>;

  getContactByEmail(email: string): Promise<ContactRecord | null>;
  getContact(id: string): Promise<ContactRecord | null>;
  insertContact(record: ContactRecord): Promise<void>;
  updateContact(
    id: string,
    patch: Partial<ContactRecord>,
    expectedVersion: number,
  ): Promise<ContactRecord>;

  getEngagement(id: string): Promise<EngagementRecord | null>;
  listEngagements(): Promise<EngagementRecord[]>;
  listEngagementsForContact(contactId: string): Promise<EngagementRecord[]>;
  insertEngagement(record: EngagementRecord): Promise<void>;
  updateEngagement(
    id: string,
    patch: Partial<EngagementRecord>,
    expectedVersion: number,
  ): Promise<EngagementRecord>;

  appendEvent(record: EventRecord): Promise<void>;
  listEvents(engagementId: string): Promise<EventRecord[]>;
  listEventsByCorrelation(correlationId: string): Promise<EventRecord[]>;

  insertReceipt(record: ReceiptRecord): Promise<void>;
  getReceipt(id: string): Promise<ReceiptRecord | null>;
  findReceipt(
    kind: string,
    submissionId: string,
  ): Promise<ReceiptRecord | null>;
  listReceipts(engagementId: string): Promise<ReceiptRecord[]>;

  insertAssessment(record: AssessmentRecord): Promise<void>;
  getAssessmentForSubmission(
    submissionId: string,
  ): Promise<AssessmentRecord | null>;
  listAssessments(engagementId: string): Promise<AssessmentRecord[]>;

  listHandbookDocs(): Promise<HandbookDocRecord[]>;
  getHandbookDoc(id: string): Promise<HandbookDocRecord | null>;
  insertHandbookDoc(record: HandbookDocRecord): Promise<void>;
  /** Optimistic: throws VersionConflictError when the doc moved on. */
  updateHandbookDoc(
    id: string,
    patch: Partial<HandbookDocRecord>,
    expectedVersion: number,
  ): Promise<HandbookDocRecord>;
  insertHandbookRevision(record: HandbookRevisionRecord): Promise<void>;
  /** Newest first. */
  listHandbookRevisions(docId: string): Promise<HandbookRevisionRecord[]>;

  insertLeadBrief(record: LeadBriefRecord): Promise<void>;
  /** The newest brief for an engagement. */
  getLeadBrief(engagementId: string): Promise<LeadBriefRecord | null>;

  upsertPerson(record: PersonRecord): Promise<PersonRecord>;
  listPeople(): Promise<PersonRecord[]>;
  setRouteOverride(record: RouteOverrideRecord): Promise<void>;
  clearRouteOverride(engagementId: string): Promise<void>;
  getRouteOverride(engagementId: string): Promise<RouteOverrideRecord | null>;
  listRouteOverrides(): Promise<RouteOverrideRecord[]>;
  /** Keeps the first assignment; returns false when the lead already had one. */
  insertAeAssignmentIfAbsent(record: AeAssignmentRecord): Promise<boolean>;
  getAeAssignment(engagementId: string): Promise<AeAssignmentRecord | null>;
  listAeAssignments(): Promise<AeAssignmentRecord[]>;

  insertDecisionIfAbsent(record: DecisionRecord): Promise<boolean>;
  getDecision(engagementId: string): Promise<DecisionRecord | null>;
  listOpenDecisions(): Promise<DecisionRecord[]>;
  updateDecision(
    id: string,
    patch: Partial<DecisionRecord>,
    expectedVersion: number,
  ): Promise<DecisionRecord>;

  listSequences(): Promise<SequenceRecord[]>;
  getSequence(id: string): Promise<SequenceRecord | null>;
  insertSequence(record: SequenceRecord): Promise<void>;
  updateSequence(
    id: string,
    patch: Partial<SequenceRecord>,
    expectedVersion: number,
  ): Promise<SequenceRecord>;

  /** Adds a lead's cadence; steps it already has are kept. */
  insertFollowUps(records: FollowUpRecord[]): Promise<void>;
  listFollowUps(engagementId: string): Promise<FollowUpRecord[]>;
  /** Scheduled, drafted, or needing an edit, across every lead. */
  listOpenFollowUps(): Promise<FollowUpRecord[]>;
  getFollowUp(id: string): Promise<FollowUpRecord | null>;
  /** Every follow-up created at or after `since` (reporting, reply labels). */
  listFollowUpsSince(since: string): Promise<FollowUpRecord[]>;
  updateFollowUp(
    id: string,
    patch: Partial<FollowUpRecord>,
    expectedVersion: number,
  ): Promise<FollowUpRecord>;

  /** Returns false when a row with the same idempotency key exists. */
  insertOutboxIfAbsent(record: OutboxRecord): Promise<boolean>;
  getOutboxByKey(idempotencyKey: string): Promise<OutboxRecord | null>;
  updateOutbox(
    id: string,
    patch: Partial<OutboxRecord>,
    expectedVersion: number,
  ): Promise<OutboxRecord>;
  /** Oldest first. */
  listOutbox(engagementId: string): Promise<OutboxRecord[]>;
  /** Every outbox row updated at or after `since`, for the send caps (D103). */
  listOutboxSince(since: string): Promise<OutboxRecord[]>;

  insertDraft(record: DraftRecord): Promise<void>;
  /** Oldest first; the last one is the current draft. */
  listDrafts(engagementId: string): Promise<DraftRecord[]>;

  insertScorecard(record: ScorecardRecord): Promise<void>;
  listScorecards(engagementId: string): Promise<ScorecardRecord[]>;

  insertReleaseIfAbsent(record: ReleaseRecord): Promise<boolean>;
  getRelease(id: string): Promise<ReleaseRecord | null>;
  latestReleaseWithLabel(label: string): Promise<ReleaseRecord | null>;

  upsertProfile(record: UserProfileRecord): Promise<UserProfileRecord>;
  listProfiles(): Promise<UserProfileRecord[]>;
  getProfile(id: string): Promise<UserProfileRecord | null>;
  getProfileByUserId(userId: string): Promise<UserProfileRecord | null>;
}
