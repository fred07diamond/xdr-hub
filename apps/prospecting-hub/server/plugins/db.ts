import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      name: "contacts-table",
      sql: `CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        title TEXT,
        company TEXT,
        email TEXT,
        phone TEXT,
        linkedin_url TEXT,
        hubspot_url TEXT,
        persona_match_score INTEGER,
        company_fit_score INTEGER,
        score_reasoning TEXT,
        source TEXT NOT NULL,
        external_id TEXT,
        persona_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        synced_at TEXT DEFAULT (datetime('now')),
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 2,
      name: "segments-table",
      sql: `CREATE TABLE IF NOT EXISTS segments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        assigned_to_email TEXT,
        visibility TEXT NOT NULL DEFAULT 'private',
        persona_id TEXT,
        filters TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        last_refreshed_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 3,
      name: "segment-contacts-table",
      sql: `CREATE TABLE IF NOT EXISTS segment_contacts (
        id TEXT PRIMARY KEY,
        segment_id TEXT NOT NULL,
        contact_id TEXT NOT NULL,
        added_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 4,
      name: "personas-table",
      sql: `CREATE TABLE IF NOT EXISTS personas (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        criteria TEXT,
        source_doc_url TEXT,
        owner_email TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 5,
      name: "sub-personas-table",
      sql: `CREATE TABLE IF NOT EXISTS sub_personas (
        id TEXT PRIMARY KEY,
        persona_id TEXT NOT NULL,
        name TEXT NOT NULL,
        criteria TEXT,
        owner_email TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 6,
      name: "contact-sub-personas-table",
      sql: `CREATE TABLE IF NOT EXISTS contact_sub_personas (
        id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL,
        sub_persona_id TEXT NOT NULL
      )`,
    },
    {
      version: 7,
      name: "analytics-events-table",
      sql: `CREATE TABLE IF NOT EXISTS analytics_events (
        id TEXT PRIMARY KEY,
        user_email TEXT NOT NULL,
        event_type TEXT NOT NULL,
        metadata TEXT,
        timestamp TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 8,
      name: "sync-records-table",
      sql: `CREATE TABLE IF NOT EXISTS sync_records (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        started_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT,
        records_pulled INTEGER,
        status TEXT NOT NULL,
        error TEXT
      )`,
    },
    {
      version: 9,
      name: "personas-color-column",
      sql: `ALTER TABLE personas ADD COLUMN color TEXT`,
    },
    {
      version: 10,
      name: "sourcing-rules-table",
      sql: `CREATE TABLE IF NOT EXISTS sourcing_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        persona_id TEXT NOT NULL,
        sub_persona_id TEXT,
        company_allow_list TEXT,
        company_deny_list TEXT,
        desired_volume INTEGER NOT NULL DEFAULT 20,
        ready_by_time TEXT NOT NULL,
        lead_hours INTEGER NOT NULL DEFAULT 3,
        segment_id TEXT NOT NULL,
        job_resource_path TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 11,
      name: "library-docs-table",
      sql: `CREATE TABLE IF NOT EXISTS library_docs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        tags TEXT,
        content TEXT NOT NULL,
        linked_persona_id TEXT,
        linked_icp_id TEXT,
        source_file_name TEXT,
        owner_email TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 12,
      name: "icps-table",
      sql: `CREATE TABLE IF NOT EXISTS icps (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        product TEXT,
        color TEXT,
        criteria TEXT,
        source_doc_url TEXT,
        owner_email TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 13,
      name: "sourcing-rules-icp-column",
      sql: `ALTER TABLE sourcing_rules ADD COLUMN icp_id TEXT`,
    },
    {
      version: 14,
      name: "contacts-engagement-score-column",
      sql: `ALTER TABLE contacts ADD COLUMN engagement_score INTEGER`,
    },
    {
      version: 15,
      name: "contacts-overall-score-column",
      sql: `ALTER TABLE contacts ADD COLUMN overall_score INTEGER`,
    },
    {
      version: 16,
      name: "sync-records-metadata-column",
      sql: `ALTER TABLE sync_records ADD COLUMN metadata TEXT`,
    },
    {
      version: 17,
      name: "contacts-country-column",
      sql: `ALTER TABLE contacts ADD COLUMN country TEXT`,
    },
    {
      version: 18,
      name: "contacts-employees-column",
      sql: `ALTER TABLE contacts ADD COLUMN employees INTEGER`,
    },
    {
      version: 19,
      name: "contacts-hubspot-ql-score-column",
      sql: `ALTER TABLE contacts ADD COLUMN hubspot_ql_score INTEGER`,
    },
    {
      version: 20,
      name: "contacts-commonroom-intent-score-column",
      sql: `ALTER TABLE contacts ADD COLUMN commonroom_intent_score INTEGER`,
    },
    {
      version: 21,
      name: "contacts-commonroom-company-fit-score-column",
      sql: `ALTER TABLE contacts ADD COLUMN commonroom_company_fit_score INTEGER`,
    },
    {
      version: 22,
      name: "focus-accounts-table",
      sql: `CREATE TABLE IF NOT EXISTS focus_accounts (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        company_name TEXT NOT NULL,
        company_domain TEXT,
        tier TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 23,
      name: "contacts-draft-email-columns",
      sql: `ALTER TABLE contacts ADD COLUMN draft_email_subject TEXT; ALTER TABLE contacts ADD COLUMN draft_email_body TEXT`,
    },
    {
      version: 24,
      name: "contacts-draft-linkedin-and-generated-at-columns",
      sql: `ALTER TABLE contacts ADD COLUMN draft_linkedin_message TEXT; ALTER TABLE contacts ADD COLUMN draft_generated_at TEXT`,
    },
    {
      version: 25,
      name: "sourcing-rules-interval-hours-column",
      sql: `ALTER TABLE sourcing_rules ADD COLUMN interval_hours INTEGER`,
    },
    {
      version: 26,
      name: "persona-documents-table",
      sql: `CREATE TABLE IF NOT EXISTS persona_documents (
        id TEXT PRIMARY KEY,
        persona_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    },
  ],
  { table: "prospecting_hub_migrations" },
);
