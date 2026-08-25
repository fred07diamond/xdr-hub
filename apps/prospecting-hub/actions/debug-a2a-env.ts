import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { requireRole } from "../server/helpers/require-role.js";

// TEMPORARY diagnostic for the A2A "Invalid or expired A2A token" investigation
// (migrate-personas-to-shared -> li-agent). Reports presence/shape only --
// never the secret value itself. Delete once the root cause is confirmed.
export default defineAction({
  description: "TEMPORARY: report this app's A2A-relevant env var presence/shape for debugging. Never returns secret values.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_input, ctx) => {
    await requireRole(ctx?.userEmail, ["admin"]);
    // guard:allow-env-credential — temporary debug-only presence/shape report, never returns the secret value
    const secret = process.env.A2A_SECRET;
    return {
      hasA2aSecret: !!secret?.trim(),
      a2aSecretLength: secret?.trim().length ?? 0,
      // guard:allow-env-credential — temporary debug-only, deploy identity var not a credential
      appBasePath: process.env.APP_BASE_PATH ?? null,
      // guard:allow-env-credential — temporary debug-only, deploy identity var not a credential
      viteAppBasePath: process.env.VITE_APP_BASE_PATH ?? null,
      // guard:allow-env-credential — temporary debug-only, deploy identity var not a credential
      url: process.env.URL ?? null,
      appUrl: process.env.APP_URL ?? null,
      // guard:allow-env-credential — temporary debug-only, deploy identity var not a credential
      deployUrl: process.env.DEPLOY_URL ?? null,
      betterAuthUrl: process.env.BETTER_AUTH_URL ?? null,
      ctxUserEmail: ctx?.userEmail ?? null,
      ctxOrgId: ctx?.orgId ?? null,
    };
  },
});
