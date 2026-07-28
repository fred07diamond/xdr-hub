import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "@agent-native/core/db/schema";
import { getSharedDb, workspaceUserRoles, workspaceAppAccess } from "@xdr-hub/shared/server";
import { getRequestUserEmail } from "@agent-native/core/server";

export default defineAction({
  description: "Update a workspace member's role and per-app access. Admin only.",
  schema: z.object({
    email: z.string().email(),
    role: z.enum(["xdr", "ae", "admin", "none"]).optional(),
    hubspotAccountId: z.string().optional(),
    grantApps: z.array(z.enum(["li-agent", "booking", "dispatch"])).optional(),
    revokeApps: z.array(z.enum(["li-agent", "booking", "dispatch"])).optional(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ email, role, hubspotAccountId, grantApps, revokeApps }, ctx) => {
    const callerEmail = await getRequestUserEmail();
    if (!callerEmail) throw Object.assign(new Error("Authentication required"), { statusCode: 401 });
    const db = getSharedDb();
    const now = new Date().toISOString();

    if (role !== undefined) {
      await db
        .insert(workspaceUserRoles)
        .values({ email, role, hubspotAccountId: hubspotAccountId ?? null, updatedAt: now })
        .onConflictDoUpdate({
          target: workspaceUserRoles.email,
          set: { role, hubspotAccountId: hubspotAccountId ?? null, updatedAt: now },
        });
    }

    for (const app of grantApps ?? []) {
      await db
        .insert(workspaceAppAccess)
        .values({ id: `${email}|${app}`, email, app, grantedBy: callerEmail })
        .onConflictDoNothing();
    }

    for (const app of revokeApps ?? []) {
      await db
        .delete(workspaceAppAccess)
        .where(eq(workspaceAppAccess.id, `${email}|${app}`));
    }

    return { ok: true, email };
  },
});
