import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { apiTokens } from "../db/schema.js";
import { isWorkspaceMember } from "@xdr-hub/shared/server";

/**
 * Resolve the owner email for a public/token-authenticated action call.
 *
 * Priority:
 *  1. Authenticated session (ctx.userEmail) -- dashboard calls
 *  2. Personal API token (apiToken arg) -- extension calls
 *
 * No env-var fallback: this is a brand-new credential path (unlike
 * li-agent's resolveOwner, which keeps a WORKSPACE_OWNER_EMAIL fallback for
 * pre-existing traffic) so there's nothing to stay backward-compatible
 * with. A caller with no session and no valid token gets null, full stop.
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

  return null;
}
