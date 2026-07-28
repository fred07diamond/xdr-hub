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
    {
      version: 5,
      sql: `ALTER TABLE booked_meetings ADD COLUMN prospect_email TEXT`,
    },
    {
      version: 6,
      sql: `ALTER TABLE generated_notes ADD COLUMN xdr_pain TEXT NOT NULL DEFAULT ''`,
    },
    {
      version: 7,
      sql: `ALTER TABLE generated_notes ADD COLUMN xdr_enterprise_need TEXT NOT NULL DEFAULT ''`,
    },
    {
      version: 8,
      sql: `ALTER TABLE generated_notes ADD COLUMN xdr_contact_qualification TEXT NOT NULL DEFAULT ''`,
    },
    {
      version: 9,
      sql: `ALTER TABLE generated_notes ADD COLUMN xdr_notes TEXT NOT NULL DEFAULT ''`,
    },
    {
      version: 10,
      sql: `ALTER TABLE generated_notes ADD COLUMN email_subject TEXT NOT NULL DEFAULT ''`,
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
  ],
  { table: "booking_agent_migrations" },
);
