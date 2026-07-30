import { requireWorkspaceAdmin } from "@xdr-hub/shared/server";

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
