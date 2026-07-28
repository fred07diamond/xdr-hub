import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getSharedDb, workspaceAppAccess } from "@xdr-hub/shared/server";
import { requireAdminOrOwner } from "../server/helpers/require-admin-or-owner.js";

export default defineAction({
  description: "Revoke a user's access to a specific app. Admin only.",
  schema: z.object({
    email: z.string().email(),
    app: z.enum(["li-agent", "booking", "dispatch"]),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ email, app }, ctx) => {
    await requireAdminOrOwner(ctx?.userEmail);
    const db = getSharedDb();
    await db
      .delete(workspaceAppAccess)
      .where(eq(workspaceAppAccess.id, `${email}|${app}`));
    return { ok: true, email, app };
  },
});
