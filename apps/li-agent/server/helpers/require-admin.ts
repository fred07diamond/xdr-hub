import { text } from "@agent-native/core/db/schema";
import { and, inArray, sql } from "drizzle-orm";
import { sqliteTable } from "drizzle-orm/sqlite-core";
import { getDb } from "../db/index.js";

// Minimal binding to the framework-managed org_members table (read-only).
const orgMembers = sqliteTable("org_members", {
  email: text("email").notNull(),
  role: text("role").notNull(),
});

/**
 * Throws unless the caller is a workspace admin or owner.
 *
 * Priority:
 *  1. WORKSPACE_OWNER_EMAIL env — always admin, no DB query needed.
 *  2. org_members table — role must be 'owner' or 'admin'.
 */
export async function requireAdmin(
  ctx: { userEmail?: string } | null | undefined,
): Promise<void> {
  if (!ctx?.userEmail) {
    throw new Error("Authentication required");
  }

  // Workspace owner is always admin — skip the DB round-trip.
  if (ctx.userEmail === process.env.WORKSPACE_OWNER_EMAIL) return;

  const db = getDb();
  const result = await db
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(
      and(
        sql`lower(${orgMembers.email}) = lower(${ctx.userEmail})`,
        inArray(orgMembers.role, ["owner", "admin"]),
      ),
    )
    .limit(1);

  if (result.length === 0) {
    throw new Error("Admin access required");
  }
}
