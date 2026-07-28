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
  // After the guard passes (user is authenticated), enforce @builder.io domain.
  const session = await getSession(event);
  if (session && !session.email.endsWith("@builder.io")) {
    throw createError({ statusCode: 403, message: "Access restricted to @builder.io accounts." });
  }
});
