import { sql } from "@agent-native/core/db/schema";
import { getSharedDb, workspaceUserRoles } from "./db/index.js";

export type WorkspaceRole = "xdr" | "ae" | "admin" | "none";

export function isWorkspaceOwner(email: string): boolean {
  const owner = process.env.WORKSPACE_OWNER_EMAIL;
  return !!owner && email.toLowerCase() === owner.toLowerCase();
}

/**
 * Resolve a user's workspace role from `workspace_user_roles`.
 *
 * The workspace owner (WORKSPACE_OWNER_EMAIL) is always at least admin even
 * with no row — this is the bootstrap path for a fresh database, matching the
 * owner treatment in li-agent's require-admin and booking's app-access
 * middleware. Without it, an empty roles table locks out everyone including
 * the only person who could grant roles.
 */
export async function getWorkspaceRole(email: string): Promise<WorkspaceRole> {
  const db = getSharedDb();
  const row = await db
    .select({ role: workspaceUserRoles.role })
    .from(workspaceUserRoles)
    .where(sql`lower(${workspaceUserRoles.email}) = lower(${email})`)
    .limit(1);
  const role = (row[0]?.role as WorkspaceRole | undefined) ?? "none";
  if (role === "none" && isWorkspaceOwner(email)) return "admin";
  return role;
}

/** Throws 401/403 unless the caller is a workspace admin (or the owner). */
export async function requireWorkspaceAdmin(
  email: string | undefined,
): Promise<void> {
  if (!email) {
    throw Object.assign(new Error("Authentication required"), {
      statusCode: 401,
    });
  }
  if (isWorkspaceOwner(email)) return;
  const role = await getWorkspaceRole(email);
  if (role !== "admin") {
    throw Object.assign(new Error("Admin access required."), {
      statusCode: 403,
    });
  }
}
