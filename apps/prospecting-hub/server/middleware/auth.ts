import { getSession, runAuthGuard } from "@agent-native/core/server";
/**
 * Global auth middleware — runs for ALL requests (page routes, API routes,
 * framework routes). The auth plugin configures the guard; this middleware
 * enforces it on every request.
 *
 * Without this, auth only runs for /_agent-native/* routes because the
 * framework handler's middleware registry is scoped to that catch-all.
 * Page routes (/, /settings) and API routes (/api/*) would bypass auth.
 */
import { createError, defineEventHandler } from "h3";

export default defineEventHandler(async (event) => {
  await runAuthGuard(event);
  // After the guard passes (user is authenticated), enforce the workspace's
  // Google Workspace domain restriction (same pattern as booking/li-agent).
  const session = await getSession(event);
  // guard:allow-env-credential — single-workspace deployment config (the one allowed email domain), not a per-user credential
  const orgDomain = process.env.WORKSPACE_ORG_DOMAIN;
  if (session && orgDomain && !session.email.toLowerCase().endsWith(`@${orgDomain.toLowerCase()}`)) {
    throw createError({ statusCode: 403, message: `Access restricted to @${orgDomain} accounts.` });
  }
});
