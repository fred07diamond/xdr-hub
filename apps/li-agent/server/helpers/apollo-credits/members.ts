import { sql } from "@agent-native/core/db/schema";
import { getSharedDb, workspaceUserRoles } from "@xdr-hub/shared/server";

// The workspace member list for the admin allocation table.
//
// Reads workspace_user_roles, the same source of truth getWorkspaceRole and
// requireWorkspaceAdmin use -- NOT the framework's org membership, which
// actions/get-my-role.ts documents as a separate, unsynced concept. Using org
// membership here would list people the admin gate does not recognise.
export interface CreditMember {
  email: string;
  role: string;
}

export async function listWorkspaceMembersForCredits(): Promise<CreditMember[]> {
  try {
    const rows = await getSharedDb()
      .select({ email: workspaceUserRoles.email, role: workspaceUserRoles.role })
      .from(workspaceUserRoles)
      .orderBy(sql`lower(${workspaceUserRoles.email})`);
    return rows
      .filter((r) => !!r.email)
      .map((r) => ({ email: r.email as string, role: (r.role as string) ?? "none" }));
  } catch {
    // The allocation table degrades to "whoever has spent this period" rather
    // than failing outright.
    return [];
  }
}
