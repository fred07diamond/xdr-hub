// Framework docs: server-database#migrations. Additive only; never drizzle-kit push.
import { runMigrations } from "@agent-native/core/db";

import { markMigrationsRunning } from "../lib/pa-context.js";

export const initialSchema = `
CREATE TABLE IF NOT EXISTS pa_inbox (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  signature_ok BOOLEAN NOT NULL DEFAULT false,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS pa_inbox_source_external_idx ON pa_inbox (source, external_id);

CREATE TABLE IF NOT EXISTS pa_submissions (
  id TEXT PRIMARY KEY,
  inbox_id TEXT NOT NULL,
  engagement_id TEXT,
  form_id TEXT,
  submitted_at TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  company_name TEXT,
  message TEXT,
  fields TEXT NOT NULL DEFAULT '{}',
  flags TEXT NOT NULL DEFAULT '[]',
  crm_contact_ref TEXT,
  page_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS pa_submissions_inbox_idx ON pa_submissions (inbox_id);
CREATE INDEX IF NOT EXISTS pa_submissions_engagement_idx ON pa_submissions (engagement_id);

CREATE TABLE IF NOT EXISTS pa_accounts (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  name TEXT,
  crm_company_ref TEXT,
  flags TEXT NOT NULL DEFAULT '{}',
  firmographics TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pa_contacts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  title TEXT,
  account_id TEXT,
  crm_contact_ref TEXT,
  language TEXT,
  opt_out BOOLEAN NOT NULL DEFAULT false,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pa_engagements (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  contact_id TEXT NOT NULL,
  motion TEXT NOT NULL DEFAULT 'contact_sale',
  state TEXT NOT NULL,
  owner_user_id TEXT,
  owner_source TEXT,
  route_reason TEXT,
  relationship_state TEXT,
  first_touch_due_at TEXT,
  decision_due_at TEXT,
  first_touch_at TEXT,
  outcome TEXT,
  attached_to_id TEXT,
  playbook_release_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'shadow',
  review_flags TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pa_engagements_contact_idx ON pa_engagements (contact_id);
CREATE INDEX IF NOT EXISTS pa_engagements_owner_idx ON pa_engagements (owner_user_id);
CREATE INDEX IF NOT EXISTS pa_engagements_state_idx ON pa_engagements (state);

CREATE TABLE IF NOT EXISTS pa_events (
  id TEXT PRIMARY KEY,
  engagement_id TEXT,
  correlation_id TEXT NOT NULL,
  type TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  receipt_id TEXT,
  occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pa_events_engagement_idx ON pa_events (engagement_id, occurred_at);

CREATE TABLE IF NOT EXISTS pa_assessments (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  intent TEXT NOT NULL,
  agency_signal BOOLEAN NOT NULL,
  evidence_quotes TEXT NOT NULL DEFAULT '[]',
  end_client_named BOOLEAN NOT NULL,
  product_interest TEXT NOT NULL,
  language TEXT NOT NULL,
  explicit_question TEXT,
  source TEXT NOT NULL,
  receipt_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pa_assessments_submission_idx ON pa_assessments (submission_id);

CREATE TABLE IF NOT EXISTS pa_scorecards (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL,
  submission_id TEXT,
  version INTEGER NOT NULL,
  verdict TEXT NOT NULL,
  reason_codes TEXT NOT NULL DEFAULT '[]',
  answers TEXT NOT NULL DEFAULT '[]',
  hypothesis TEXT,
  receipt_id TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS pa_scorecards_engagement_version_idx ON pa_scorecards (engagement_id, version);

CREATE TABLE IF NOT EXISTS pa_drafts (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL,
  subject TEXT,
  body TEXT,
  cta TEXT,
  language TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  used_entry_ids TEXT NOT NULL DEFAULT '[]',
  lint TEXT,
  edited_body TEXT,
  edit_reasons TEXT NOT NULL DEFAULT '[]',
  approved_by TEXT,
  receipt_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pa_receipts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  engagement_id TEXT,
  submission_id TEXT,
  playbook_release_id TEXT NOT NULL,
  entry_versions TEXT NOT NULL DEFAULT '[]',
  rule_results TEXT NOT NULL DEFAULT '{}',
  inputs TEXT NOT NULL DEFAULT '{}',
  agent_run_id TEXT,
  tool_calls TEXT,
  model TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pa_receipts_submission_kind_idx ON pa_receipts (submission_id, kind);
CREATE INDEX IF NOT EXISTS pa_receipts_engagement_idx ON pa_receipts (engagement_id);

CREATE TABLE IF NOT EXISTS pa_outbox (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  engagement_id TEXT,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  provider_ref TEXT,
  last_error TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pa_notifications (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL,
  user_id TEXT,
  slack_channel TEXT,
  slack_ts TEXT,
  last_rendered_hash TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pa_provider_calls (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT,
  status TEXT NOT NULL,
  http_status INTEGER,
  duration_ms INTEGER,
  cost_units DOUBLE PRECISION,
  decision_ref TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pa_playbook_releases (
  id TEXT PRIMARY KEY,
  short_id TEXT NOT NULL,
  entries TEXT NOT NULL,
  content TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pa_playbook_releases_label_idx ON pa_playbook_releases (label, created_at);

CREATE TABLE IF NOT EXISTS pa_labels (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  labeler TEXT NOT NULL,
  expected_route TEXT,
  expected_verdict TEXT,
  expected_first_move TEXT,
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pa_corrections (
  id TEXT PRIMARY KEY,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  note TEXT,
  user_id TEXT NOT NULL,
  receipt_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pa_user_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  slack_user_id TEXT,
  crm_owner_id TEXT,
  timezone TEXT NOT NULL,
  working_hours TEXT NOT NULL,
  roles TEXT NOT NULL DEFAULT '[]',
  in_round_robin BOOLEAN NOT NULL DEFAULT false,
  is_design_partner BOOLEAN NOT NULL DEFAULT false,
  is_synthetic BOOLEAN NOT NULL DEFAULT false,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

// Additive: one open engagement per contact (FR-2). Portable on SQLite and
// Postgres, where a unique index admits many NULLs.
export const openEngagementGuard = `
ALTER TABLE pa_engagements ADD COLUMN open_contact_id TEXT;
UPDATE pa_engagements SET open_contact_id = contact_id WHERE state NOT IN ('recycled', 'disqualified', 'closed');
CREATE UNIQUE INDEX IF NOT EXISTS pa_engagements_open_contact_idx ON pa_engagements (open_contact_id)
`;

// Additive: the dynamic playbook (D44). Releases stay immutable; the label
// table is the one mutable pointer. Change sets, approvals, and suggestions.
export const dynamicPlaybook = `
CREATE TABLE IF NOT EXISTS pa_release_labels (
  label TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  moved_by TEXT NOT NULL,
  moved_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pa_playbook_changes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  rationale TEXT NOT NULL,
  author_email TEXT NOT NULL,
  author_kind TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'draft',
  base_release_id TEXT NOT NULL,
  result_release_id TEXT,
  required_teams TEXT NOT NULL DEFAULT '[]',
  checks TEXT,
  impact TEXT,
  checked_against TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pa_playbook_changes_status_idx ON pa_playbook_changes (status, updated_at);

CREATE TABLE IF NOT EXISTS pa_playbook_change_items (
  id TEXT PRIMARY KEY,
  change_id TEXT NOT NULL,
  target TEXT NOT NULL,
  op TEXT NOT NULL,
  before_value TEXT,
  after_value TEXT,
  owner_team TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS pa_playbook_change_items_target_idx ON pa_playbook_change_items (change_id, target);

CREATE TABLE IF NOT EXISTS pa_playbook_approvals (
  id TEXT PRIMARY KEY,
  change_id TEXT NOT NULL,
  team TEXT NOT NULL,
  reviewer_email TEXT NOT NULL,
  decision TEXT NOT NULL,
  note TEXT,
  on_behalf BOOLEAN NOT NULL DEFAULT false,
  checked_against TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS pa_playbook_approvals_unique_idx ON pa_playbook_approvals (change_id, team, reviewer_email);

CREATE TABLE IF NOT EXISTS pa_suggestions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  audience TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL,
  release_id TEXT,
  change_id TEXT,
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  decided_by TEXT,
  decided_at TEXT,
  notified_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS pa_suggestions_dedupe_idx ON pa_suggestions (dedupe_key);
CREATE INDEX IF NOT EXISTS pa_suggestions_audience_idx ON pa_suggestions (audience, status, created_at)
`;

// The shared workspace roles table that getWorkspaceRole reads (D35). In
// production every app shares one database, so it already exists; in local dev
// each app has its own SQLite file, so every app creates it, as the sibling
// apps do. Same columns as packages/shared; portable default (D40).
export const sharedWorkspaceRoles = `
CREATE TABLE IF NOT EXISTS workspace_user_roles (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'none',
  hubspot_account_id TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)
`;

// Additive: the portal's CRM property definitions for mapping (D48). Names,
// types, and options only; never record data.
export const crmSchemaSnapshot = `
CREATE TABLE IF NOT EXISTS pa_crm_schema (
  crm_object TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  properties TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  fetched_by TEXT NOT NULL
)
`;

// Additive: a draft records the submission it answers and who wrote it
// (the drafting agent, or the fixture drafter in replay and demo).
export const draftSource = `
ALTER TABLE pa_drafts ADD COLUMN submission_id TEXT;
ALTER TABLE pa_drafts ADD COLUMN source TEXT;
CREATE INDEX IF NOT EXISTS pa_drafts_engagement_idx ON pa_drafts (engagement_id, created_at)
`;

// Additive: the Sales handbook (D53). PA-owned reference docs on the sales
// cycle and how the team operates, edited in the app with every version kept.
export const salesHandbook = `
CREATE TABLE IF NOT EXISTS pa_handbook_docs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  body TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'current',
  source TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pa_handbook_revisions (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  edited_by TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS pa_handbook_revisions_doc_version ON pa_handbook_revisions (doc_id, version)
`;

// Additive: the rep decision loop (D59), one decision per engagement.
export const repDecisions = `
CREATE TABLE IF NOT EXISTS pa_decisions (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '[]',
  recommendation TEXT NOT NULL,
  recommendation_reason TEXT NOT NULL,
  question TEXT,
  owner_email TEXT,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  choice TEXT,
  note TEXT,
  decided_by TEXT,
  decided_at TEXT,
  sla_missed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS pa_decisions_engagement ON pa_decisions (engagement_id)
`;

// Additive: the lead brief (D61), the agent's CRM-note read of each lead.
export const leadBriefs = `
CREATE TABLE IF NOT EXISTS pa_lead_briefs (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL,
  brief TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pa_lead_briefs_engagement ON pa_lead_briefs (engagement_id, created_at)
`;

export const leadRouting = `
CREATE TABLE IF NOT EXISTS pa_people (
  email TEXT PRIMARY KEY,
  display_name TEXT,
  role TEXT,
  meeting_link TEXT,
  pod_ae_email TEXT,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pa_route_overrides (
  engagement_id TEXT PRIMARY KEY,
  route TEXT NOT NULL,
  note TEXT,
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL
)
`;

// The one list of PA migrations: the runtime and the integration tests both
// apply exactly this, so a migration cannot exist without being registered.
export const PA_MIGRATIONS = [
  { version: 1, name: "pa-initial-schema", sql: initialSchema },
  {
    version: 2,
    name: "pa-one-open-engagement-per-contact",
    sql: openEngagementGuard,
  },
  { version: 3, name: "pa-dynamic-playbook", sql: dynamicPlaybook },
  { version: 4, name: "pa-shared-workspace-roles", sql: sharedWorkspaceRoles },
  { version: 5, name: "pa-crm-schema-snapshot", sql: crmSchemaSnapshot },
  { version: 6, name: "pa-draft-source", sql: draftSource },
  { version: 7, name: "pa-sales-handbook", sql: salesHandbook },
  { version: 8, name: "pa-rep-decisions", sql: repDecisions },
  { version: 9, name: "pa-lead-briefs", sql: leadBriefs },
  { version: 10, name: "pa-lead-routing", sql: leadRouting },
];

export const runPaMigrations = runMigrations(PA_MIGRATIONS, {
  table: "pa_migrations",
});

export default async (nitroApp: unknown): Promise<void> => {
  const done = Promise.resolve(runPaMigrations(nitroApp as never));
  markMigrationsRunning(done);
  await done;
};
