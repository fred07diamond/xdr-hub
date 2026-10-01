// Portable schema helpers (framework docs: portability, server-database).
// They pick pg-core or sqlite-core at runtime, so the same tables run on local
// SQLite and on Neon Postgres. Timestamps are ISO-8601 UTC text so ordering is
// lexical on both. JSON columns are TEXT on both dialects; server/db/json.ts
// is the only place that encodes and decodes them.
import {
  index,
  integer,
  real,
  table,
  text,
  uniqueIndex,
} from "@agent-native/core/db/schema";

const json = (name: string) => text(name);
const bool = (name: string) => integer(name, { mode: "boolean" });

const stamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

export const paInbox = table(
  "pa_inbox",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    receivedAt: text("received_at").notNull(),
    signatureOk: bool("signature_ok").notNull().default(false),
    payload: json("payload").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: text("next_attempt_at"),
    version: integer("version").notNull().default(1),
    ...stamps,
  },
  (t) => [
    uniqueIndex("pa_inbox_source_external_idx").on(t.source, t.externalId),
  ],
);

export const paSubmissions = table(
  "pa_submissions",
  {
    id: text("id").primaryKey(),
    inboxId: text("inbox_id").notNull(),
    engagementId: text("engagement_id"),
    formId: text("form_id"),
    submittedAt: text("submitted_at").notNull(),
    email: text("email").notNull(),
    name: text("name"),
    companyName: text("company_name"),
    message: text("message"),
    fields: json("fields").notNull().default("{}"),
    flags: json("flags").notNull().default("[]"),
    crmContactRef: text("crm_contact_ref"),
    pageUrl: text("page_url"),
    ...stamps,
  },
  (t) => [
    uniqueIndex("pa_submissions_inbox_idx").on(t.inboxId),
    index("pa_submissions_engagement_idx").on(t.engagementId),
  ],
);

export const paAccounts = table("pa_accounts", {
  id: text("id").primaryKey(),
  domain: text("domain").notNull().unique(),
  name: text("name"),
  crmCompanyRef: text("crm_company_ref"),
  flags: json("flags").notNull().default("{}"),
  firmographics: json("firmographics"),
  version: integer("version").notNull().default(1),
  ...stamps,
});

export const paContacts = table("pa_contacts", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  title: text("title"),
  accountId: text("account_id"),
  crmContactRef: text("crm_contact_ref"),
  language: text("language"),
  optOut: bool("opt_out").notNull().default(false),
  version: integer("version").notNull().default(1),
  ...stamps,
});

export const paEngagements = table(
  "pa_engagements",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id"),
    contactId: text("contact_id").notNull(),
    // contact_id while the engagement is open, NULL once it closes. The unique
    // index keeps one open engagement per contact under concurrent submissions
    // (FR-2). Maintained only by the repository (migration v2).
    openContactId: text("open_contact_id"),
    motion: text("motion").notNull().default("contact_sale"),
    state: text("state").notNull(),
    ownerUserId: text("owner_user_id"),
    ownerSource: text("owner_source"),
    routeReason: text("route_reason"),
    relationshipState: text("relationship_state"),
    firstTouchDueAt: text("first_touch_due_at"),
    decisionDueAt: text("decision_due_at"),
    firstTouchAt: text("first_touch_at"),
    outcome: text("outcome"),
    attachedToId: text("attached_to_id"),
    playbookReleaseId: text("playbook_release_id").notNull(),
    mode: text("mode").notNull().default("shadow"),
    reviewFlags: json("review_flags").notNull().default("[]"),
    version: integer("version").notNull().default(1),
    ...stamps,
  },
  (t) => [
    index("pa_engagements_contact_idx").on(t.contactId),
    uniqueIndex("pa_engagements_open_contact_idx").on(t.openContactId),
    index("pa_engagements_owner_idx").on(t.ownerUserId),
    index("pa_engagements_state_idx").on(t.state),
  ],
);

export const paEvents = table(
  "pa_events",
  {
    id: text("id").primaryKey(),
    engagementId: text("engagement_id"),
    correlationId: text("correlation_id").notNull(),
    type: text("type").notNull(),
    actor: text("actor").notNull(),
    payload: json("payload").notNull().default("{}"),
    receiptId: text("receipt_id"),
    occurredAt: text("occurred_at").notNull(),
  },
  (t) => [index("pa_events_engagement_idx").on(t.engagementId, t.occurredAt)],
);

export const paAssessments = table(
  "pa_assessments",
  {
    id: text("id").primaryKey(),
    engagementId: text("engagement_id").notNull(),
    submissionId: text("submission_id").notNull(),
    intent: text("intent").notNull(),
    agencySignal: bool("agency_signal").notNull(),
    evidenceQuotes: json("evidence_quotes").notNull().default("[]"),
    endClientNamed: bool("end_client_named").notNull(),
    productInterest: text("product_interest").notNull(),
    language: text("language").notNull(),
    explicitQuestion: text("explicit_question"),
    source: text("source").notNull(),
    receiptId: text("receipt_id"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("pa_assessments_submission_idx").on(t.submissionId)],
);

export const paScorecards = table(
  "pa_scorecards",
  {
    id: text("id").primaryKey(),
    engagementId: text("engagement_id").notNull(),
    submissionId: text("submission_id"),
    version: integer("version").notNull(),
    verdict: text("verdict").notNull(),
    reasonCodes: json("reason_codes").notNull().default("[]"),
    answers: json("answers").notNull().default("[]"),
    hypothesis: json("hypothesis"),
    receiptId: text("receipt_id"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("pa_scorecards_engagement_version_idx").on(
      t.engagementId,
      t.version,
    ),
  ],
);

export const paDrafts = table("pa_drafts", {
  id: text("id").primaryKey(),
  engagementId: text("engagement_id").notNull(),
  subject: text("subject"),
  body: text("body"),
  cta: text("cta"),
  language: text("language"),
  status: text("status").notNull().default("proposed"),
  usedEntryIds: json("used_entry_ids").notNull().default("[]"),
  lint: json("lint"),
  editedBody: text("edited_body"),
  editReasons: json("edit_reasons").notNull().default("[]"),
  approvedBy: text("approved_by"),
  receiptId: text("receipt_id"),
  // v6 (additive): which submission the draft answers, and who wrote it.
  submissionId: text("submission_id"),
  source: text("source"),
  version: integer("version").notNull().default(1),
  ...stamps,
});

export const paReceipts = table(
  "pa_receipts",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    engagementId: text("engagement_id"),
    submissionId: text("submission_id"),
    playbookReleaseId: text("playbook_release_id").notNull(),
    entryVersions: json("entry_versions").notNull().default("[]"),
    ruleResults: json("rule_results").notNull().default("{}"),
    inputs: json("inputs").notNull().default("{}"),
    agentRunId: text("agent_run_id"),
    toolCalls: json("tool_calls"),
    model: text("model"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("pa_receipts_submission_kind_idx").on(t.submissionId, t.kind),
    index("pa_receipts_engagement_idx").on(t.engagementId),
  ],
);

export const paOutbox = table("pa_outbox", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  engagementId: text("engagement_id"),
  payload: json("payload").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: text("next_attempt_at"),
  providerRef: text("provider_ref"),
  lastError: text("last_error"),
  version: integer("version").notNull().default(1),
  ...stamps,
});

export const paNotifications = table("pa_notifications", {
  id: text("id").primaryKey(),
  engagementId: text("engagement_id").notNull(),
  userId: text("user_id"),
  slackChannel: text("slack_channel"),
  slackTs: text("slack_ts"),
  lastRenderedHash: text("last_rendered_hash"),
  version: integer("version").notNull().default(1),
  ...stamps,
});

export const paProviderCalls = table("pa_provider_calls", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  operation: text("operation").notNull(),
  idempotencyKey: text("idempotency_key"),
  status: text("status").notNull(),
  httpStatus: integer("http_status"),
  durationMs: integer("duration_ms"),
  costUnits: real("cost_units"),
  decisionRef: text("decision_ref"),
  createdAt: text("created_at").notNull(),
});

export const paPlaybookReleases = table(
  "pa_playbook_releases",
  {
    id: text("id").primaryKey(),
    shortId: text("short_id").notNull(),
    entries: json("entries").notNull(),
    content: json("content").notNull(),
    label: text("label").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("pa_playbook_releases_label_idx").on(t.label, t.createdAt)],
);

export const paLabels = table("pa_labels", {
  id: text("id").primaryKey(),
  submissionId: text("submission_id").notNull(),
  labeler: text("labeler").notNull(),
  expectedRoute: text("expected_route"),
  expectedVerdict: text("expected_verdict"),
  expectedFirstMove: text("expected_first_move"),
  notes: text("notes"),
  version: integer("version").notNull().default(1),
  ...stamps,
});

export const paCorrections = table("pa_corrections", {
  id: text("id").primaryKey(),
  targetKind: text("target_kind").notNull(),
  targetId: text("target_id").notNull(),
  reasonCode: text("reason_code").notNull(),
  note: text("note"),
  userId: text("user_id").notNull(),
  receiptId: text("receipt_id"),
  createdAt: text("created_at").notNull(),
});

export const paUserProfiles = table("pa_user_profiles", {
  id: text("id").primaryKey(),
  userId: text("user_id").unique(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  slackUserId: text("slack_user_id"),
  crmOwnerId: text("crm_owner_id"),
  timezone: text("timezone").notNull(),
  workingHours: json("working_hours").notNull(),
  roles: json("roles").notNull().default("[]"),
  inRoundRobin: bool("in_round_robin").notNull().default(false),
  isDesignPartner: bool("is_design_partner").notNull().default(false),
  isSynthetic: bool("is_synthetic").notNull().default(false),
  version: integer("version").notNull().default(1),
  ...stamps,
});

// Dynamic playbook (D44), migration v3.
export const paReleaseLabels = table("pa_release_labels", {
  label: text("label").primaryKey(),
  releaseId: text("release_id").notNull(),
  movedBy: text("moved_by").notNull(),
  movedAt: text("moved_at").notNull(),
  version: integer("version").notNull().default(1),
});

export const paPlaybookChanges = table(
  "pa_playbook_changes",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    rationale: text("rationale").notNull(),
    authorEmail: text("author_email").notNull(),
    authorKind: text("author_kind").notNull().default("user"),
    status: text("status").notNull().default("draft"),
    baseReleaseId: text("base_release_id").notNull(),
    resultReleaseId: text("result_release_id"),
    requiredTeams: json("required_teams").notNull().default("[]"),
    checks: json("checks"),
    impact: json("impact"),
    // Fingerprint of the items the checks and approvals were made against.
    checkedAgainst: text("checked_against"),
    version: integer("version").notNull().default(1),
    ...stamps,
  },
  (t) => [index("pa_playbook_changes_status_idx").on(t.status, t.updatedAt)],
);

export const paPlaybookChangeItems = table(
  "pa_playbook_change_items",
  {
    id: text("id").primaryKey(),
    changeId: text("change_id").notNull(),
    // An entry id (rule.routing.order) or a config key (config.routing_pool).
    target: text("target").notNull(),
    op: text("op").notNull(),
    beforeValue: json("before_value"),
    afterValue: json("after_value"),
    ownerTeam: text("owner_team").notNull(),
    ...stamps,
  },
  (t) => [
    uniqueIndex("pa_playbook_change_items_target_idx").on(t.changeId, t.target),
  ],
);

export const paPlaybookApprovals = table(
  "pa_playbook_approvals",
  {
    id: text("id").primaryKey(),
    changeId: text("change_id").notNull(),
    team: text("team").notNull(),
    reviewerEmail: text("reviewer_email").notNull(),
    decision: text("decision").notNull(),
    note: text("note"),
    onBehalf: bool("on_behalf").notNull().default(false),
    checkedAgainst: text("checked_against").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("pa_playbook_approvals_unique_idx").on(
      t.changeId,
      t.team,
      t.reviewerEmail,
    ),
  ],
);

export const paSuggestions = table(
  "pa_suggestions",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    audience: text("audience").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    evidence: json("evidence").notNull().default("{}"),
    source: text("source").notNull(),
    releaseId: text("release_id"),
    changeId: text("change_id"),
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status").notNull().default("open"),
    decidedBy: text("decided_by"),
    decidedAt: text("decided_at"),
    notifiedAt: text("notified_at"),
    version: integer("version").notNull().default(1),
    ...stamps,
  },
  (t) => [
    uniqueIndex("pa_suggestions_dedupe_idx").on(t.dedupeKey),
    index("pa_suggestions_audience_idx").on(t.audience, t.status, t.createdAt),
  ],
);

// The portal's CRM property definitions (D48), migration v5.
export const paCrmSchema = table("pa_crm_schema", {
  crmObject: text("crm_object").primaryKey(),
  provider: text("provider").notNull(),
  properties: text("properties").notNull(),
  fetchedAt: text("fetched_at").notNull(),
  fetchedBy: text("fetched_by").notNull(),
});

// The Sales handbook (D53): PA-owned reference docs, every version kept.
export const paHandbookDocs = table("pa_handbook_docs", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  summary: text("summary"),
  body: text("body").notNull(),
  position: integer("position").notNull().default(0),
  status: text("status").notNull().default("current"),
  source: text("source"),
  version: integer("version").notNull().default(1),
  updatedBy: text("updated_by").notNull(),
  ...stamps,
});

export const paHandbookRevisions = table(
  "pa_handbook_revisions",
  {
    id: text("id").primaryKey(),
    docId: text("doc_id").notNull(),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    editedBy: text("edited_by").notNull(),
    note: text("note"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("pa_handbook_revisions_doc_version").on(t.docId, t.version),
  ],
);

// The rep decision loop (D59): one decision per engagement.
export const paDecisions = table(
  "pa_decisions",
  {
    id: text("id").primaryKey(),
    engagementId: text("engagement_id").notNull(),
    kind: text("kind").notNull(),
    options: json("options").notNull().default("[]"),
    recommendation: text("recommendation").notNull(),
    recommendationReason: text("recommendation_reason").notNull(),
    question: text("question"),
    ownerEmail: text("owner_email"),
    dueAt: text("due_at").notNull(),
    status: text("status").notNull().default("open"),
    choice: text("choice"),
    note: text("note"),
    decidedBy: text("decided_by"),
    decidedAt: text("decided_at"),
    slaMissedAt: text("sla_missed_at"),
    version: integer("version").notNull().default(1),
    ...stamps,
  },
  (t) => [uniqueIndex("pa_decisions_engagement").on(t.engagementId)],
);

// The lead brief (D61): the agent's CRM-note read, every version kept.
export const paLeadBriefs = table(
  "pa_lead_briefs",
  {
    id: text("id").primaryKey(),
    engagementId: text("engagement_id").notNull(),
    brief: json("brief").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("pa_lead_briefs_engagement").on(t.engagementId, t.createdAt)],
);

// Lead routing (D66), migration v10. The people a lead can be routed to, with
// their meeting links, and a PA's override of the playbook's route. Links and
// pairings are team data: they live here, never in source.
export const paPeople = table("pa_people", {
  email: text("email").primaryKey(),
  displayName: text("display_name"),
  role: text("role"),
  meetingLink: text("meeting_link"),
  podAeEmail: text("pod_ae_email"),
  updatedBy: text("updated_by").notNull(),
  ...stamps,
});

export const paRouteOverrides = table("pa_route_overrides", {
  engagementId: text("engagement_id").primaryKey(),
  route: text("route").notNull(),
  note: text("note"),
  setBy: text("set_by").notNull(),
  setAt: text("set_at").notNull(),
});

// Enterprise AE round robin (D78), migration v11: who each lead was given,
// kept so a lead keeps its AE and the rotation stays fair.
export const paAeAssignments = table("pa_ae_assignments", {
  engagementId: text("engagement_id").primaryKey(),
  aeEmail: text("ae_email").notNull(),
  method: text("method").notNull(),
  assignedAt: text("assigned_at").notNull(),
});
