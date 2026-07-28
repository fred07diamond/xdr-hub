import { requireAdmin } from "./require-admin.js";

export async function requireAdminOrOwner(email: string | undefined): Promise<void> {
  await requireAdmin({ userEmail: email });
}
