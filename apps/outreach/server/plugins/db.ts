import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS prospects (
        id TEXT PRIMARY KEY,
        profile_url TEXT NOT NULL UNIQUE,
        name TEXT,
        headline TEXT,
        role TEXT,
        company TEXT,
        about TEXT,
        recent_activity TEXT,
        fit_verdict TEXT,
        fit_reason TEXT,
        draft_note TEXT,
        draft_follow_up TEXT,
        status TEXT NOT NULL DEFAULT 'captured',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 2,
      sql: `CREATE TABLE IF NOT EXISTS send_history (
        id TEXT PRIMARY KEY,
        profile_url TEXT NOT NULL,
        sent_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 3,
      sql: `CREATE TABLE IF NOT EXISTS icp_sources (
        id TEXT PRIMARY KEY DEFAULT 'singleton',
        sources TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 4,
      sql: `ALTER TABLE prospects ADD COLUMN persona_id TEXT`,
    },
    {
      version: 5,
      sql: `ALTER TABLE prospects ADD COLUMN persona_name TEXT`,
    },
    {
      version: 6,
      sql: `ALTER TABLE prospects ADD COLUMN persona_color TEXT`,
    },
    {
      version: 7,
      sql: `CREATE TABLE IF NOT EXISTS icp_personas (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#6366f1',
        icp_text TEXT,
        summary TEXT,
        is_active INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    // Rebuild prospects: drop global profile_url UNIQUE, add owner_email, compound unique index.
    // Multi-statement migration — the framework splits on ';' and runs each in sequence.
    {
      version: 8,
      sql: [
        `CREATE TABLE IF NOT EXISTS prospects_v2 (
          id TEXT PRIMARY KEY,
          owner_email TEXT,
          profile_url TEXT NOT NULL,
          name TEXT, headline TEXT, role TEXT, company TEXT, about TEXT, recent_activity TEXT,
          fit_verdict TEXT, fit_reason TEXT, draft_note TEXT, draft_follow_up TEXT,
          persona_id TEXT, persona_name TEXT, persona_color TEXT,
          status TEXT NOT NULL DEFAULT 'captured',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )`,
        `INSERT INTO prospects_v2
          SELECT id, NULL as owner_email, profile_url, name, headline, role, company, about,
                 recent_activity, fit_verdict, fit_reason, draft_note, draft_follow_up,
                 persona_id, persona_name, persona_color, status, created_at, updated_at
          FROM prospects
          ON CONFLICT DO NOTHING`,
        `DROP TABLE IF EXISTS prospects`,
        `ALTER TABLE prospects_v2 RENAME TO prospects`,
        `CREATE UNIQUE INDEX IF NOT EXISTS prospects_url_owner ON prospects(profile_url, COALESCE(owner_email, ''))`,
      ].join(";\n"),
    },
    {
      version: 9,
      sql: `ALTER TABLE send_history ADD COLUMN owner_email TEXT`,
    },
    {
      version: 10,
      sql: `CREATE TABLE IF NOT EXISTS api_tokens (
        id TEXT PRIMARY KEY,
        user_email TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    { version: 11, sql: `ALTER TABLE prospects ADD COLUMN rating INTEGER` },
    { version: 12, sql: `ALTER TABLE prospects ADD COLUMN rating_note TEXT` },
    {
      version: 13,
      sql: `CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        user_email TEXT,
        message TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 14,
      sql: `ALTER TABLE icp_sources ADD COLUMN IF NOT EXISTS icp_text TEXT`,
    },
    {
      version: 15,
      sql: `CREATE TABLE IF NOT EXISTS workspace_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 16,
      sql: `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS sentiment TEXT`,
    },
    {
      version: 17,
      sql: `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS draft_note TEXT`,
    },
    {
      version: 18,
      sql: `CREATE TABLE IF NOT EXISTS messaging_nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'user',
        title TEXT NOT NULL DEFAULT 'New Node',
        persona_id TEXT,
        tone TEXT,
        value_props TEXT,
        phrases_to_use TEXT,
        phrases_to_avoid TEXT,
        example_notes TEXT,
        notes TEXT,
        position_x INTEGER NOT NULL DEFAULT 100,
        position_y INTEGER NOT NULL DEFAULT 100,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 19,
      sql: `CREATE TABLE IF NOT EXISTS messaging_edges (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 20,
      // Repurpose type='user' → specific node types. 'global' stays as-is.
      sql: `UPDATE messaging_nodes SET type = 'tone' WHERE type = 'user'`,
    },
    { version: 21, sql: `ALTER TABLE messaging_nodes ADD COLUMN owner_email TEXT` },
    { version: 22, sql: `ALTER TABLE messaging_edges ADD COLUMN owner_email TEXT` },
    { version: 23, sql: `CREATE INDEX IF NOT EXISTS prospects_owner_created ON prospects(owner_email, created_at DESC)` },
    { version: 24, sql: `CREATE INDEX IF NOT EXISTS prospects_owner_status ON prospects(owner_email, status)` },
    { version: 25, sql: `CREATE INDEX IF NOT EXISTS messaging_nodes_owner_type ON messaging_nodes(owner_email, type)` },
    { version: 26, sql: `CREATE INDEX IF NOT EXISTS messaging_edges_source_owner ON messaging_edges(source_id, owner_email)` },
    { version: 27, sql: `CREATE INDEX IF NOT EXISTS messaging_edges_owner ON messaging_edges(owner_email)` },
    { version: 28, sql: `CREATE INDEX IF NOT EXISTS send_history_owner_url ON send_history(owner_email, profile_url)` },
    { version: 29, sql: `CREATE INDEX IF NOT EXISTS api_tokens_token ON api_tokens(token)` },
    { version: 30, sql: `CREATE INDEX IF NOT EXISTS icp_personas_active ON icp_personas(is_active)` },
  ],
  { table: "outreach_migrations" },
);
