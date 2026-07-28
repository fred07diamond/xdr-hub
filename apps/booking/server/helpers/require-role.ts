import { eq } from "drizzle-orm";
import { getSharedDb, workspaceUserRoles } from "../db/workspace.js";

export type UserRole = "xdr" | "ae" | "admin" | "none";

export async function getUserRole(email: string): Promise<UserRole> {
  const db = getSharedDb();
  const row = await db
    .select({ role: workspaceUserRoles.role })
    .from(workspaceUserRoles)
    .where(eq(workspaceUserRoles.email, email))
    .limit(1);
  return (row[0]?.role as UserRole) ?? "none";
}

export async function requireRole(
  email: string | undefined,
  allowed: UserRole[]
): Promise<UserRole> {
  if (!email) {
    throw Object.assign(new Error("Authentication required"), { statusCode: 401 });
  }
  const role = await getUserRole(email);
  if (role === "none") {
    throw Object.assign(
      new Error("Your account is pending approval. Contact fred@builder.io to get access."),
      { statusCode: 403 }
    );
  }
  if (!allowed.includes(role)) {
    throw Object.assign(new Error("Access denied."), { statusCode: 403 });
  }
  return role;
}
