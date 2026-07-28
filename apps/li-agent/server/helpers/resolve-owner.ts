import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { apiTokens } from "../db/schema.js";
import { isWorkspaceMember } from "./workspace-org.js";

/**
 * Resolve the owner email for an action call.
 *
 * Priority:
 *  1. Authenticated session  (ctx.userEmail) — dashboard calls
 *  2. Personal API token     (apiToken arg)  — extension calls
 *  3. Workspace owner email  (WORKSPACE_OWNER_EMAIL env) — backward compat
 *
 * Returns null if the API token user is not a member of the workspace org.
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
      if (!(await isWorkspaceMember(email))) return null;
      return email;
    }
  }

  return process.env.WORKSPACE_OWNER_EMAIL ?? null;
}
