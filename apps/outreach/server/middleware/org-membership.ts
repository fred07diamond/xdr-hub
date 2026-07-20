import { text } from "@agent-native/core/db/schema";
import { sql } from "drizzle-orm";
import { sqliteTable } from "drizzle-orm/sqlite-core";
import { defineEventHandler, getRequestURL, setResponseStatus } from "h3";
import { getDb } from "../db/index.js";

// Paths the extension calls without a session — auth is handled by API token
// inside each action, not here.
const PUBLIC_ACTION_PATHS = new Set([
  "/_agent-native/actions/capture-profile",
  "/_agent-native/actions/get-draft",
  "/_agent-native/actions/mark-sent",
  "/_agent-native/actions/check-already-contacted",
  "/_agent-native/actions/get-daily-stats",
]);

const orgMembers = sqliteTable("org_members", {
  email: text("email").notNull(),
  role: text("role").notNull(),
});

// Runs after auth.ts (alphabetical order). Rejects authenticated users who
// have been removed from the org so removal takes effect immediately.
export default defineEventHandler(async (event) => {
  const pathname = getRequestURL(event).pathname;

  // Only enforce on action routes — page routes serve the SPA which handles
  // the RequireActiveOrg check client-side.
  if (!pathname.startsWith("/_agent-native/actions/")) return;
  if (PUBLIC_ACTION_PATHS.has(pathname)) return;

  const userEmail = event.context?.userEmail as string | undefined;
  if (!userEmail) return; // unauthenticated — auth guard already handled this

  // Workspace owner always has access.
  if (userEmail === process.env.WORKSPACE_OWNER_EMAIL) return;

  const db = getDb();
  const row = await db
    .select({ email: orgMembers.email })
    .from(orgMembers)
    .where(sql`lower(${orgMembers.email}) = lower(${userEmail})`)
    .limit(1);

  if (row.length === 0) {
    setResponseStatus(event, 403);
    return { error: "Your access has been removed. Contact your workspace admin." };
  }
});
