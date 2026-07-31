import { getWorkspaceRole } from "@xdr-hub/shared/server";

// "Manager" in the spec maps to the shared "admin" role. XDR/AE map directly.
export type UserRole = "xdr" | "ae" | "admin" | "none";

export async function getUserRole(email: string): Promise<UserRole> {
  return getWorkspaceRole(email);
}

export async function requireRole(
  email: string | undefined,
  allowed: UserRole[],
): Promise<UserRole> {
  if (!email) {
    throw Object.assign(new Error("Authentication required"), { statusCode: 401 });
  }
  const role = await getUserRole(email);
  if (role === "none") {
    throw Object.assign(
      new Error("Your account is pending approval. Contact fred@builder.io to get access."),
      { statusCode: 403 },
    );
  }
  if (!allowed.includes(role)) {
    throw Object.assign(new Error("Access denied."), { statusCode: 403 });
  }
  return role;
}
