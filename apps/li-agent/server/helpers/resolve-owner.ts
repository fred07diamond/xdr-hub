import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { apiTokens } from "../db/schema.js";
import { isWorkspaceMember } from "@xdr-hub/shared/server";

/**
 * Resolve the owner email from a REAL credential only — an authenticated
 * session or a valid personal API token belonging to a workspace member.
 * Never falls back to the workspace owner. Use this for anything that
 * searches or exposes org data (e.g. a live HubSpot lookup) so a
 * credential-free caller gets nothing instead of being silently treated as
 * the workspace owner.
 */
export async function resolveOwnerStrict(
  apiToken: string | null | undefined,
  ctx: { userEmail?: string } | null | undefined,
): Promise<string | null> {
  if (ctx?.userEmail) return ctx.userEmail;

  if (apiToken) {
    const db = getDb();
    const row = await db
      .select({ userEmail: apiTokens.userEmail })
      .from(apiTokens)
      .where(eq(apiTokens.token, apiToken))
      .limit(1);
    if (row[0]) {
      const email = row[0].userEmail;
      if (!(await isWorkspaceMember(email, db))) return null;
      return email;
    }
  }

  return null;
}

/**
 * Resolve the owner email for an action call.
 *
 * Priority:
 *  1. Authenticated session  (ctx.userEmail) — dashboard calls
 *  2. Personal API token     (apiToken arg)  — extension calls
 *  3. Workspace owner email  (WORKSPACE_OWNER_EMAIL env) — backward compat,
 *     only when NO token/session was supplied at all
 *
 * Returns null (no fallback) if a token WAS supplied but doesn't belong to a
 * workspace member — an invalid/foreign token must never quietly resolve to
 * the workspace owner.
 *
 * NOTE: the env fallback (step 3) means a caller with NO credentials at all
 * is still treated as the workspace owner today. That's intentionally being
 * phased out — see resolveOwnerStrict for the credential-required version,
 * used anywhere that fallback would be a real security gap.
 *
 * SOFT-LAUNCH MONITORING: every time step 3 actually fires (a real,
 * credential-free call), this logs a warning instead of silently succeeding.
 * Watch for `[resolve-owner] fallback used` in server logs — if that's
 * genuinely never hit by real traffic, step 3 can be deleted outright
 * (delete this whole fallback branch and always return null instead) with
 * zero impact on any legitimate user. If it DOES fire, whoever it's coming
 * from needs to set up their personal API token in Settings before this is
 * tightened, since that's the extension's only real credential path.
 */
export async function resolveOwner(
  apiToken: string | null | undefined,
  ctx: { userEmail?: string } | null | undefined,
): Promise<string | null> {
  if (ctx?.userEmail) return ctx.userEmail;

  if (apiToken) {
    const db = getDb();
    const row = await db
      .select({ userEmail: apiTokens.userEmail })
      .from(apiTokens)
      .where(eq(apiTokens.token, apiToken))
      .limit(1);
    if (row[0]) {
      const email = row[0].userEmail;
      if (!(await isWorkspaceMember(email, db))) return null;
      return email;
    }
  }

  // guard:allow-env-credential — single-workspace deployment config (the one workspace owner), not a per-user credential
  const fallback = process.env.WORKSPACE_OWNER_EMAIL ?? null;
  if (fallback) {
    const callSite = new Error().stack?.split("\n")[2]?.trim().slice(0, 160) ?? "unknown";
    console.warn(
      `[resolve-owner] fallback used — no session, no valid token, treated as workspace owner (${fallback}). ` +
      `Caller: ${callSite}`,
    );
  }
  return fallback;
}
