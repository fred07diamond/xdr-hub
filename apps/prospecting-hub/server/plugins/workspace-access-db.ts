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
  ],
  { table: "prospecting_hub_workspace_migrations" },
);
