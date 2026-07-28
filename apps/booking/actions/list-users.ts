import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getSharedDb, workspaceUserRoles } from "../server/db/workspace.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "List all users and their roles. Admin only.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_args, ctx) => {
    await requireRole(ctx?.userEmail, ["admin"]);
    const db = getSharedDb();
    const rows = await db
      .select({
        email: workspaceUserRoles.email,
        role: workspaceUserRoles.role,
        hubspotAccountId: workspaceUserRoles.hubspotAccountId,
        updatedAt: workspaceUserRoles.updatedAt,
      })
      .from(workspaceUserRoles)
      .orderBy(workspaceUserRoles.email);
    return { users: rows };
  },
});
