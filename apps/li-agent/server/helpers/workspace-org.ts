import { text } from "@agent-native/core/db/schema";
import { sql } from "drizzle-orm";
import { sqliteTable } from "drizzle-orm/sqlite-core";
import { getDb } from "../db/index.js";

const orgMembers = sqliteTable("org_members", {
  email: text("email").notNull(),
  role: text("role").notNull(),
  orgId: text("org_id").notNull(),
});

// Resolved once per process — avoids a DB round-trip on every action call.
let _workspaceOrgId: string | null | undefined = undefined;

/**
 * Returns the org_id for the workspace (the org owned by WORKSPACE_OWNER_EMAIL).
 * Cached after the first successful lookup. Returns null if the owner row is missing.
 */
export async function getWorkspaceOrgId(): Promise<string | null> {
  if (_workspaceOrgId !== undefined) return _workspaceOrgId;
  const ownerEmail = process.env.WORKSPACE_OWNER_EMAIL;
  if (!ownerEmail) {
    _workspaceOrgId = null;
    return null;
  }
  const db = getDb();
  const row = await db
    .select({ orgId: orgMembers.orgId })
    .from(orgMembers)
    .where(sql`lower(${orgMembers.email}) = lower(${ownerEmail}) AND ${orgMembers.role} = 'owner'`)
    .limit(1);
  _workspaceOrgId = row[0]?.orgId ?? null;
  return _workspaceOrgId;
}

/**
 * Returns true if the given email is a member of the workspace org.
 * The workspace owner always returns true without a DB lookup.
 */
export async function isWorkspaceMember(email: string): Promise<boolean> {
  if (email === process.env.WORKSPACE_OWNER_EMAIL) return true;
  const workspaceOrgId = await getWorkspaceOrgId();
  if (!workspaceOrgId) return false;
  const db = getDb();
  const row = await db
    .select({ email: orgMembers.email })
    .from(orgMembers)
    .where(sql`lower(${orgMembers.email}) = lower(${email}) AND ${orgMembers.orgId} = ${workspaceOrgId}`)
    .limit(1);
  return row.length > 0;
}
