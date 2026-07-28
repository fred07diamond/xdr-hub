import { runMigrations } from "@agent-native/core/db";

// Dispatch's `list-workspace-team` / `update-workspace-member` actions read
// and write the shared `workspace_user_roles` / `workspace_app_access`
// tables (packages/shared/src/server/db/schema.ts) directly against
// Dispatch's own database via `getSharedDb()`. booking and li-agent each
// create these same tables in their own `runMigrations` lists, but Dispatch
// never did, so the tables never existed here and every read/write 500'd.
export default runMigrations(
  [
    {
      version: 1,
      name: "dispatch-workspace-user-roles-table",
      sql: `CREATE TABLE IF NOT EXISTS workspace_user_roles (
        email TEXT PRIMARY KEY,
        role TEXT NOT NULL DEFAULT 'none',
        hubspot_account_id TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 2,
      name: "dispatch-workspace-app-access-table",
      sql: `CREATE TABLE IF NOT EXISTS workspace_app_access (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        app TEXT NOT NULL,
        granted_by TEXT,
        granted_at TEXT DEFAULT (datetime('now'))
      )`,
    },
  ],
  { table: "dispatch_workspace_migrations" },
);
