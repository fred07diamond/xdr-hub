import { defineEventHandler, getRequestURL, setResponseStatus } from "h3";
import { eq, and } from "drizzle-orm";
import { getSharedDb, getWorkspaceRole, isWorkspaceMember, workspaceAppAccess } from "@xdr-hub/shared/server";
import { getDb } from "../db/index.js";

const APP_NAME = "li-agent" as const;
const DISPATCH_URL = process.env.APP_URL
  ? process.env.APP_URL.replace(/\/li-agent.*$/, "")
  : "https://xdr-hub.netlify.app";

// Runs after org-membership.ts. Enforces per-app access grants.
// Existing org members without an access row are auto-granted on first visit
// (backward compatibility). Once a grant exists, access can be revoked.
export default defineEventHandler(async (event) => {
  const pathname = getRequestURL(event).pathname;

  if (!pathname.startsWith("/_agent-native/actions/")) return;

  const userEmail = event.context?.userEmail as string | undefined;
  if (!userEmail) return;

  if (userEmail === process.env.WORKSPACE_OWNER_EMAIL) return;

  // Workspace admins always have access to every app, including its
  // admin-only surfaces (e.g. the Analytics page) -- being made an admin
  // via set-workspace-user-role.ts is a deliberate, privileged grant that
  // must not then get silently blocked by the separate org-membership
  // check below. This was the actual cause of "some admins can't see
  // Analytics": this middleware only ever auto-granted based on org
  // membership, never on workspace role, so an admin who wasn't also a
  // recognized org member got 403'd here before get-analytics.ts's own
  // requireAdmin check ever ran.
  const role = await getWorkspaceRole(userEmail);
  if (role === "admin") return;

  const db = getSharedDb();

  const [existing] = await db
    .select({ id: workspaceAppAccess.id })
    .from(workspaceAppAccess)
    .where(and(eq(workspaceAppAccess.email, userEmail), eq(workspaceAppAccess.app, APP_NAME)))
    .limit(1);

  if (existing) return;

  // No explicit grant — auto-grant if they're already an org member (backward compat).
  const isMember = await isWorkspaceMember(userEmail, getDb());
  if (isMember) {
    await db.insert(workspaceAppAccess).values({
      id: `${userEmail}|${APP_NAME}`,
      email: userEmail,
      app: APP_NAME,
      grantedBy: "system:auto",
    }).onConflictDoNothing();
    return;
  }

  setResponseStatus(event, 403);
  return {
    error: `You don't have access to LinkedIn Agent. Visit ${DISPATCH_URL} to request access.`,
  };
});
