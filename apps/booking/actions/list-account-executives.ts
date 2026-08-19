import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getSharedDb, workspaceUserRoles } from "../server/db/workspace.js";
import { requireRole } from "../server/helpers/require-role.js";
import { resolveOwner } from "../server/helpers/resolve-owner.js";

export default defineAction({
  description: "List every Account Executive (role=ae) in the workspace, for AE picker dropdowns. Callable from the Nooks Capture browser extension via a personal API token.",
  schema: z.object({ apiToken: z.string().nullish() }),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: true, requiresAuth: false },
  http: { method: "GET" },
  run: async ({ apiToken }, ctx) => {
    const ownerEmail = await resolveOwner(apiToken, ctx);
    await requireRole(ownerEmail ?? undefined, ["xdr", "ae", "admin"]);
    const db = getSharedDb();
    const rows = await db
      .select({ email: workspaceUserRoles.email })
      .from(workspaceUserRoles)
      .where(eq(workspaceUserRoles.role, "ae"))
      .orderBy(workspaceUserRoles.email);
    return { aes: rows.map((r) => r.email) };
  },
});
