import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { userRoles } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Set the role for a user by email. Admin only.",
  schema: z.object({
    email: z.string().email(),
    role: z.enum(["xdr", "ae", "admin", "none"]),
    hubspotAccountId: z.string().optional(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ email, role, hubspotAccountId }, ctx) => {
    await requireRole(ctx?.userEmail, ["admin"]);
    const db = getDb();
    const now = new Date().toISOString();
    await db
      .insert(userRoles)
      .values({ email, role, hubspotAccountId: hubspotAccountId ?? null, updatedAt: now })
      .onConflictDoUpdate({
        target: userRoles.email,
        set: { role, hubspotAccountId: hubspotAccountId ?? null, updatedAt: now },
      });
    return { ok: true, email, role };
  },
});
