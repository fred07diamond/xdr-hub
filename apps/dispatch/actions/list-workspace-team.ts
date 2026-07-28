import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getSharedDb, workspaceUserRoles, workspaceAppAccess } from "@xdr-hub/shared/server";
import { getRequestUserEmail } from "@agent-native/core/server";

export default defineAction({
  description: "List all workspace users with their roles and per-app access. Admin only.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async () => {
    const email = await getRequestUserEmail();
    if (!email) throw Object.assign(new Error("Authentication required"), { statusCode: 401 });
    const db = getSharedDb();
    const [roles, access] = await Promise.all([
      db.select().from(workspaceUserRoles).orderBy(workspaceUserRoles.email),
      db.select().from(workspaceAppAccess).orderBy(workspaceAppAccess.email),
    ]);
    const accessByEmail: Record<string, string[]> = {};
    for (const row of access) {
      (accessByEmail[row.email] ??= []).push(row.app);
    }
    return {
      users: roles.map((r) => ({
        email: r.email,
        role: r.role,
        hubspotAccountId: r.hubspotAccountId,
        apps: accessByEmail[r.email] ?? [],
      })),
    };
  },
});
