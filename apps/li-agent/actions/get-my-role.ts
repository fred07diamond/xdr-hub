import { defineAction } from "@agent-native/core";
import { getWorkspaceRole } from "@xdr-hub/shared/server";
import { z } from "zod";

// Client-side admin gates (Analytics, Agent tab, Settings admin sections)
// must check this instead of the framework's own org role (owner/admin/
// member via useOrgRole/canManageOrg) -- that's a separate, unsynced
// concept from the shared workspace_user_roles table every real admin-only
// action here (requireAdmin -> requireWorkspaceAdmin) actually enforces.
// Promoting someone to "Admin" on Dispatch's Organization page never
// touches workspace_user_roles, so a client gate built on canManageOrg can
// let someone see a page whose data call then rejects them.
export default defineAction({
  description: "Get the current user's workspace role (xdr/ae/admin/none) so the UI can gate admin-only controls.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_args, ctx) => {
    if (!ctx?.userEmail) return { role: "none" as const };
    const role = await getWorkspaceRole(ctx.userEmail);
    return { role };
  },
});
