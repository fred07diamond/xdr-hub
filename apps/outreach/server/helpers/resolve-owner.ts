import { text } from "@agent-native/core/db/schema";
import { eq, sql } from "drizzle-orm";
import { sqliteTable } from "drizzle-orm/sqlite-core";
import { getDb } from "../db/index.js";
import { apiTokens } from "../db/schema.js";

const orgMembers = sqliteTable("org_members", {
  email: text("email").notNull(),
});

async function isOrgMember(email: string): Promise<boolean> {
  if (email === process.env.WORKSPACE_OWNER_EMAIL) return true;
  const db = getDb();
  const row = await db
    .select({ email: orgMembers.email })
    .from(orgMembers)
    .where(sql`lower(${orgMembers.email}) = lower(${email})`)
    .limit(1);
  return row.length > 0;
}

/**
 * Resolve the owner email for an action call.
 *
 * Priority:
 *  1. Authenticated session  (ctx.userEmail) — dashboard calls
 *  2. Personal API token     (apiToken arg)  — extension calls
 *  3. Workspace owner email  (WORKSPACE_OWNER_EMAIL env) — backward compat
 *
 * Returns null if the API token user has been removed from the org.
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
      if (!(await isOrgMember(email))) return null;
      return email;
    }
  }

  return process.env.WORKSPACE_OWNER_EMAIL ?? null;
}
