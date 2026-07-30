import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getSharedDb, workspaceUserRoles } from "@xdr-hub/shared/server";
import { requireAdminOrOwner } from "../server/helpers/require-admin-or-owner.js";

export default defineAction({
  description: "Set the workspace role for a user by email. Admin only.",
  schema: z.object({
    email: z.string().email(),
    role: z.enum(["xdr", "ae", "admin", "none"]),
    hubspotAccountId: z.string().optional(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ email: rawEmail, role, hubspotAccountId }, ctx) => {
    await requireAdminOrOwner(ctx?.userEmail);
    const email = rawEmail.toLowerCase();
    const db = getSharedDb();
    const now = new Date().toISOString();
    await db
      .insert(workspaceUserRoles)
      .values({ email, role, hubspotAccountId: hubspotAccountId ?? null, updatedAt: now })
      .onConflictDoUpdate({
        target: workspaceUserRoles.email,
        set: { role, hubspotAccountId: hubspotAccountId ?? null, updatedAt: now },
      });
    return { ok: true, email, role };
  },
});
