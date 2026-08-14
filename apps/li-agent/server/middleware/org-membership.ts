import { defineEventHandler, getRequestURL, setResponseStatus } from "h3";
import { getWorkspaceOrgId, isWorkspaceMember } from "@xdr-hub/shared/server";
import { getDb } from "../db/index.js";

// Paths the extension calls without a session — auth is handled by API token
// inside each action, not here. This list is documentation only: the actual
// enforcement is each action's own `requiresAuth` flag at dispatch time, so
// an action missing from this list isn't a gap — but keep it accurate so the
// next reader isn't misled about what's actually public.
const PUBLIC_ACTION_PATHS = new Set([
  "/_agent-native/actions/capture-profile",
  "/_agent-native/actions/get-draft",
  "/_agent-native/actions/mark-sent",
  "/_agent-native/actions/check-already-contacted",
  "/_agent-native/actions/get-daily-stats",
  "/_agent-native/actions/submit-feedback",
  "/_agent-native/actions/check-hubspot-contact",
  "/_agent-native/actions/list-canvases",
  "/_agent-native/actions/ingest-post-engager",
  "/_agent-native/actions/enrich-post-engager",
  "/_agent-native/actions/get-post-engager",
  "/_agent-native/actions/resolve-connect-button",
  "/_agent-native/actions/import-sales-nav-list",
  "/_agent-native/actions/list-lead-lists-for-extension",
  "/_agent-native/actions/apollo-phone-reveal-webhook",
]);

// Runs after auth.ts (alphabetical order). Rejects authenticated users who
// are not members of the workspace org. Checks against the specific org_id
// owned by WORKSPACE_OWNER_EMAIL — not just any org — so a user's personal
// auto-created org does not grant access.
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

  // Resolve workspace org_id and check membership in that specific org.
  const db = getDb();
  const workspaceOrgId = await getWorkspaceOrgId(db);
  if (!workspaceOrgId) return; // Can't determine workspace org — owner check above covers it

  const isMember = await isWorkspaceMember(userEmail, db);
  if (!isMember) {
    setResponseStatus(event, 403);
    return { error: "Your access has been removed. Contact your workspace admin." };
  }
});
