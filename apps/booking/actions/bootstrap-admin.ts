import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getSharedDb, workspaceUserRoles } from "../server/db/workspace.js";

export default defineAction({
  description: "Bootstrap: assign admin role to an email. Only callable by WORKSPACE_OWNER_EMAIL.",
  schema: z.object({
    email: z.string().email(),
    role: z
      .enum(["xdr", "ae", "admin", "none"])
      .default("admin"),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ email, role }, ctx) => {
    // guard:allow-env-credential — single-workspace deployment config (the one workspace owner), not a per-user credential
    const ownerEmail = process.env.WORKSPACE_OWNER_EMAIL;
    if (!ownerEmail || ctx?.userEmail !== ownerEmail) {
      throw Object.assign(new Error("Only the workspace owner can bootstrap roles."), { statusCode: 403 });
    }
    const db = getSharedDb();
    const now = new Date().toISOString();
    await db
      .insert(workspaceUserRoles)
      .values({ email, role, updatedAt: now })
      .onConflictDoUpdate({ target: workspaceUserRoles.email, set: { role, updatedAt: now } });
    return { ok: true, email, role };
  },
});
