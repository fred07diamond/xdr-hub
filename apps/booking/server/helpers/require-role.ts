import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { userRoles } from "../db/schema.js";

export type UserRole = "xdr" | "ae" | "admin" | "none";

export async function getUserRole(email: string): Promise<UserRole> {
  const db = getDb();
  const row = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.email, email))
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
