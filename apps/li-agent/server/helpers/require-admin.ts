import { requireWorkspaceAdmin } from "@xdr-hub/shared/server";
import { resolveOwnerStrict } from "./resolve-owner.js";

/**
 * Throws unless the caller is a workspace admin (or the owner).
 *
 * Delegates entirely to the shared `requireWorkspaceAdmin`, the same gate
 * Dispatch's Team & Access page and Booking use — this used to run its own,
 * separate check against the framework's `org_members` table, which let
 * someone who was merely an org member (but never made an admin via
 * Dispatch) call li-agent's own admin actions, including the ones that
 * grant workspace roles and app access. There is now exactly one admin
 * source of truth across all three apps.
 */
export async function requireAdmin(
  ctx: { userEmail?: string } | null | undefined,
): Promise<void> {
  await requireWorkspaceAdmin(ctx?.userEmail);
}

/**
 * Admin gate for an action that both the dashboard (session) and the Chrome
 * extension (personal API token) call -- the ICP persona document actions.
 *
 * Resolves a REAL credential first (resolveOwnerStrict, so a call with
 * neither session nor valid token is rejected rather than falling back to
 * the workspace owner) and only then applies the same admin check the
 * dashboard-only ICP actions use. Managing ICP docs from the side panel
 * must not be an easier path than managing them from the ICP tab.
 *
 * Returns the resolved caller email.
 */
export async function requireAdminFromSessionOrToken(
  apiToken: string | null | undefined,
  ctx: { userEmail?: string } | null | undefined,
): Promise<string> {
  const email = await resolveOwnerStrict(apiToken, ctx);
  if (!email) throw new Error("Not authorized — sign in or set your personal API token in Settings.");
  await requireAdmin({ userEmail: email });
  return email;
}
