import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { userRoles } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "List all users and their roles. Admin only.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_args, ctx) => {
    await requireRole(ctx?.userEmail, ["admin"]);
    const db = getDb();
    const rows = await db
      .select({
        email: userRoles.email,
        role: userRoles.role,
        hubspotAccountId: userRoles.hubspotAccountId,
        updatedAt: userRoles.updatedAt,
      })
      .from(userRoles)
      .orderBy(userRoles.email);
    return { users: rows };
  },
});
