import { runMigrations } from "@agent-native/core/db";

// This app's require-role.ts / segment-access.ts read the shared
// workspace_user_roles table (packages/shared/src/server/db/schema.ts)
// via getSharedDb(). In local dev each app has its own SQLite file, so
// every app that reads this table needs its own migration creating it —
// booking, li-agent, and dispatch each do the same (dispatch's version has
// the full story on why this is needed per-app, not just once).
export default runMigrations(
  [
    {
      version: 1,
      name: "prospecting-hub-workspace-user-roles-table",
      sql: `CREATE TABLE IF NOT EXISTS workspace_user_roles (
        email TEXT PRIMARY KEY,
        role TEXT NOT NULL DEFAULT 'none',
        hubspot_account_id TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 2,
      name: "prospecting-hub-workspace-app-access-table",
      sql: `CREATE TABLE IF NOT EXISTS workspace_app_access (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        app TEXT NOT NULL,
        granted_by TEXT,
        granted_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    // Shared personas/Sales Library (packages/shared/src/server/db/schema.ts)
    // -- same "every app needs its own idempotent copy" reasoning as above,
    // now extended past roles/app-access to real product data both this app
    // and li-agent read/write live.
    {
      version: 3,
      name: "prospecting-hub-shared-personas-table",
      sql: `CREATE TABLE IF NOT EXISTS shared_personas (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT,
        description TEXT,
        source_doc_url TEXT,
        is_active INTEGER NOT NULL DEFAULT 0,
        summary TEXT,
        briefing TEXT,
        briefing_generated_at TEXT,
        briefing_source_hash TEXT,
        owner_email TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 4,
      name: "prospecting-hub-shared-persona-docs-table",
      sql: `CREATE TABLE IF NOT EXISTS shared_persona_docs (
        id TEXT PRIMARY KEY,
        persona_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        content TEXT NOT NULL,
        word_count INTEGER,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 5,
      name: "prospecting-hub-shared-library-docs-table",
      sql: `CREATE TABLE IF NOT EXISTS shared_library_docs (
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
    // Migration-only review queue -- see schema.ts's own comment. Only
    // prospecting-hub's one-time migrate-personas-to-shared.ts reads/writes
    // this, so only this app needs a copy.
    {
      version: 6,
      name: "prospecting-hub-persona-migration-reviews-table",
      sql: `CREATE TABLE IF NOT EXISTS persona_migration_reviews (
        id TEXT PRIMARY KEY,
        prospecting_hub_persona_id TEXT,
        prospecting_hub_persona_name TEXT,
        li_agent_persona_id TEXT,
        li_agent_persona_name TEXT,
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        resolved_shared_persona_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        resolved_at TEXT
      )`,
    },
  ],
  { table: "prospecting_hub_workspace_migrations" },
);
