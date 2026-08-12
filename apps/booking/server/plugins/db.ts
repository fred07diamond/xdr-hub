import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS user_roles (
        email TEXT PRIMARY KEY,
        role TEXT NOT NULL DEFAULT 'none',
        hubspot_account_id TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 2,
      sql: `CREATE TABLE IF NOT EXISTS booked_meetings (
        id TEXT PRIMARY KEY,
        prospect_name TEXT NOT NULL,
        company TEXT NOT NULL,
        meeting_datetime TEXT,
        ae_user_email TEXT NOT NULL DEFAULT '',
        xdr_user_email TEXT NOT NULL,
        calendar_event_id TEXT,
        meeting_link TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 3,
      sql: `CREATE TABLE IF NOT EXISTS generated_notes (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL,
        xdr_user_email TEXT NOT NULL DEFAULT '',
        meeting_agenda TEXT NOT NULL DEFAULT '',
        crm_notes TEXT NOT NULL DEFAULT '',
        follow_up_email TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT DEFAULT (datetime('now')),
        confirmed_at TEXT
      )`,
    },
    {
      version: 4,
      sql: `CREATE TABLE IF NOT EXISTS deals (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL,
        deal_name TEXT,
        associated_contact TEXT,
        company TEXT,
        ae_owner_email TEXT,
        hubspot_deal_id TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    // v5-v10 use ADD COLUMN IF NOT EXISTS: prod once crashed between applying
    // v5 and recording it, so re-runs hit "column already exists" and halted
    // the whole list (v11+ never applied). IF NOT EXISTS makes re-runs
    // converge; the framework adapts the clause for SQLite too.
    {
      version: 5,
      sql: `ALTER TABLE booked_meetings ADD COLUMN IF NOT EXISTS prospect_email TEXT`,
    },
    {
      version: 6,
      sql: `ALTER TABLE generated_notes ADD COLUMN IF NOT EXISTS xdr_pain TEXT NOT NULL DEFAULT ''`,
    },
    {
      version: 7,
      sql: `ALTER TABLE generated_notes ADD COLUMN IF NOT EXISTS xdr_enterprise_need TEXT NOT NULL DEFAULT ''`,
    },
    {
      version: 8,
      sql: `ALTER TABLE generated_notes ADD COLUMN IF NOT EXISTS xdr_contact_qualification TEXT NOT NULL DEFAULT ''`,
    },
    {
      version: 9,
      sql: `ALTER TABLE generated_notes ADD COLUMN IF NOT EXISTS xdr_notes TEXT NOT NULL DEFAULT ''`,
    },
    {
      version: 10,
      sql: `ALTER TABLE generated_notes ADD COLUMN IF NOT EXISTS email_subject TEXT NOT NULL DEFAULT ''`,
    },
    {
      version: 11,
      sql: `CREATE TABLE IF NOT EXISTS workspace_user_roles (
        email TEXT PRIMARY KEY,
        role TEXT NOT NULL DEFAULT 'none',
        hubspot_account_id TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 12,
      sql: `INSERT INTO workspace_user_roles (email, role, hubspot_account_id, updated_at)
            SELECT email, role, hubspot_account_id, updated_at FROM user_roles
            WHERE true ON CONFLICT(email) DO NOTHING`,
    },
    {
      version: 13,
      sql: `CREATE TABLE IF NOT EXISTS workspace_app_access (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        app TEXT NOT NULL,
        granted_by TEXT,
        granted_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 14,
      name: "booked-meetings-nooks-call-id",
      sql: `ALTER TABLE booked_meetings ADD COLUMN IF NOT EXISTS nooks_call_id TEXT`,
    },
    {
      version: 15,
      name: "booked-meetings-nooks-call-id-unique",
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_booked_meetings_nooks_call_id ON booked_meetings(nooks_call_id)`,
    },
    {
      version: 16,
      name: "inbound-leads",
      sql: `CREATE TABLE IF NOT EXISTS inbound_leads (
        id TEXT PRIMARY KEY,
        hubspot_contact_id TEXT NOT NULL,
        prospect_name TEXT NOT NULL,
        prospect_email TEXT,
        company TEXT,
        contact_sales_date TEXT,
        seen INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 17,
      name: "inbound-leads-hubspot-contact-id-unique",
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_leads_hubspot_contact_id ON inbound_leads(hubspot_contact_id)`,
    },
    // v17's plain per-contact unique index blocks a contact from ever being
    // detected again after their first submission -- most_recent_contact_
    // sales_date updates on every resubmission, so the same contact
    // resubmitting later is a genuinely new lead. Replace with a composite
    // index on (contact_id, contact_sales_date) instead.
    {
      version: 18,
      name: "inbound-leads-drop-contact-id-only-unique",
      sql: `DROP INDEX IF EXISTS idx_inbound_leads_hubspot_contact_id`,
    },
    {
      version: 19,
      name: "inbound-leads-contact-id-date-unique",
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_leads_contact_id_date ON inbound_leads(hubspot_contact_id, contact_sales_date)`,
    },
    {
      version: 20,
      name: "inbound-leads-outreach-fields",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS qualification_tier TEXT`,
    },
    {
      version: 21,
      name: "inbound-leads-outreach-fields-2",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS meeting_agenda TEXT`,
    },
    {
      version: 22,
      name: "inbound-leads-outreach-fields-3",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS xdr_pain TEXT`,
    },
    {
      version: 23,
      name: "inbound-leads-outreach-fields-4",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS xdr_contact_qualification TEXT`,
    },
    {
      version: 24,
      name: "inbound-leads-outreach-fields-5",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS xdr_notes TEXT`,
    },
    {
      version: 25,
      name: "inbound-leads-outreach-fields-6",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS crm_note TEXT`,
    },
    {
      version: 26,
      name: "inbound-leads-outreach-fields-7",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS outreach_email TEXT`,
    },
    {
      version: 27,
      name: "inbound-leads-outreach-fields-8",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS email_subject TEXT`,
    },
    {
      version: 28,
      name: "inbound-leads-outreach-fields-9",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS outreach_generated_at TEXT`,
    },
    // v29+ replace the old outreach fields above (qualification_tier,
    // meeting_agenda, xdr_pain, xdr_contact_qualification, xdr_notes,
    // crm_note, outreach_email, email_subject, outreach_generated_at --
    // still physically present in SQLite but no longer referenced by
    // schema.ts or any action) with the Intro Call Assistant's checkpoint +
    // decision + worksheet fields.
    {
      version: 29,
      name: "inbound-leads-intro-tldr",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS intro_tldr TEXT`,
    },
    {
      version: 30,
      name: "inbound-leads-intro-hubspot-summary",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS intro_hubspot_summary TEXT`,
    },
    {
      version: 31,
      name: "inbound-leads-intro-scorecard-text",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS intro_scorecard_text TEXT`,
    },
    {
      version: 32,
      name: "inbound-leads-intro-pain-score",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS intro_pain_score INTEGER`,
    },
    {
      version: 33,
      name: "inbound-leads-intro-pain-label",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS intro_pain_label TEXT`,
    },
    {
      version: 34,
      name: "inbound-leads-intro-champion-score",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS intro_champion_score INTEGER`,
    },
    {
      version: 35,
      name: "inbound-leads-intro-champion-label",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS intro_champion_label TEXT`,
    },
    {
      version: 36,
      name: "inbound-leads-intro-recommendation",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS intro_recommendation TEXT`,
    },
    {
      version: 37,
      name: "inbound-leads-intro-recommendation-rationale",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS intro_recommendation_rationale TEXT`,
    },
    {
      version: 38,
      name: "inbound-leads-intro-checkpoint-generated-at",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS intro_checkpoint_generated_at TEXT`,
    },
    {
      version: 39,
      name: "inbound-leads-intro-decision",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS intro_decision TEXT`,
    },
    {
      version: 40,
      name: "inbound-leads-intro-output-subject",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS intro_output_subject TEXT`,
    },
    {
      version: 41,
      name: "inbound-leads-intro-output-body",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS intro_output_body TEXT`,
    },
    {
      version: 42,
      name: "inbound-leads-intro-ae-name",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS intro_ae_name TEXT`,
    },
    {
      version: 43,
      name: "inbound-leads-intro-ae-email",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS intro_ae_email TEXT`,
    },
    {
      version: 44,
      name: "inbound-leads-intro-time-works",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS intro_time_works INTEGER`,
    },
    {
      version: 45,
      name: "inbound-leads-intro-alt-time-1",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS intro_alt_time_1 TEXT`,
    },
    {
      version: 46,
      name: "inbound-leads-intro-alt-time-2",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS intro_alt_time_2 TEXT`,
    },
    {
      version: 47,
      name: "inbound-leads-intro-decision-generated-at",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS intro_decision_generated_at TEXT`,
    },
    {
      version: 48,
      name: "inbound-leads-intro-worksheet",
      sql: `ALTER TABLE inbound_leads ADD COLUMN IF NOT EXISTS intro_worksheet TEXT`,
    },
  ],
  { table: "booking_agent_migrations" },
);
