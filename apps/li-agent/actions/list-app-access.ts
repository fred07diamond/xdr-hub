import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getSharedDb, workspaceAppAccess } from "@xdr-hub/shared/server";
import { requireAdminOrOwner } from "../server/helpers/require-admin-or-owner.js";

export default defineAction({
  description: "List per-app access grants for all users. Admin only.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_args, ctx) => {
    await requireAdminOrOwner(ctx?.userEmail);
    const db = getSharedDb();
    const rows = await db
      .select()
      .from(workspaceAppAccess)
      .orderBy(workspaceAppAccess.email);
    return { access: rows };
  },
});
