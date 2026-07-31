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
  ],
  { table: "prospecting_hub_migrations" },
);
