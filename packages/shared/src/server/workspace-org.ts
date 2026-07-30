import { sql, table, text } from "@agent-native/core/db/schema";

// Minimal, read-only, portable binding to the framework-managed org_members
// table. This is a PER-APP table (each app has its own Better Auth org
// membership), so callers must pass their own app's db instance — this
// module deliberately does not own a db connection itself.
const orgMembers = table("org_members", {
  email: text("email").notNull(),
  role: text("role").notNull(),
  orgId: text("org_id").notNull(),
});

// db is intentionally loosely typed — every app's getDb() has a different
// concrete Drizzle generic, but the query shape used here is identical
// across all of them.
type AnyDb = any;

// Keyed by db instance, NOT a single module-level value — this module is
// shared code imported by multiple apps, each with its own separate
// org_members table. A single cached value would leak one app's org_id into
// another app's lookups.
const orgIdCache = new WeakMap<object, string | null>();

/**
 * Returns the org_id for the workspace (the org owned by WORKSPACE_OWNER_EMAIL)
 * in the given app's database. Cached per db instance after the first
 * successful lookup. Returns null if the owner row is missing.
 */
export async function getWorkspaceOrgId(db: AnyDb): Promise<string | null> {
  if (orgIdCache.has(db)) return orgIdCache.get(db)!;
  const ownerEmail = process.env.WORKSPACE_OWNER_EMAIL;
  if (!ownerEmail) {
    orgIdCache.set(db, null);
    return null;
  }
  const row = await db
    .select({ orgId: orgMembers.orgId })
    .from(orgMembers)
    .where(sql`lower(${orgMembers.email}) = lower(${ownerEmail}) AND ${orgMembers.role} = 'owner'`)
    .limit(1);
  const orgId = row[0]?.orgId ?? null;
  orgIdCache.set(db, orgId);
  return orgId;
}

/**
 * Returns true if the given email is a member of the workspace org in the
 * given app's database. The workspace owner always returns true (case
 * insensitively) without a DB lookup.
 */
export async function isWorkspaceMember(email: string, db: AnyDb): Promise<boolean> {
  const owner = process.env.WORKSPACE_OWNER_EMAIL;
  if (owner && email.toLowerCase() === owner.toLowerCase()) return true;

  const workspaceOrgId = await getWorkspaceOrgId(db);
  if (!workspaceOrgId) return false;
  const row = await db
    .select({ email: orgMembers.email })
    .from(orgMembers)
    .where(sql`lower(${orgMembers.email}) = lower(${email}) AND ${orgMembers.orgId} = ${workspaceOrgId}`)
    .limit(1);
  return row.length > 0;
}
