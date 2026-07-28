import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getSharedDb, workspaceAppAccess } from "@xdr-hub/shared/server";
import { requireAdminOrOwner } from "../server/helpers/require-admin-or-owner.js";

export default defineAction({
  description: "Grant a user access to a specific app. Admin only.",
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
      .insert(workspaceAppAccess)
      .values({
        id: `${email}|${app}`,
        email,
        app,
        grantedBy: ctx?.userEmail ?? "admin",
      })
      .onConflictDoNothing();
    return { ok: true, email, app };
  },
});
