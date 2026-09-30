// The workspace owner's identity for background work (D35, D58). The poll has
// no signed-in user, but HubSpot credentials and the inbound agent are
// scoped to the organization, so background work runs as the owner.
import { resolveOrgIdForEmail } from "@agent-native/core/org";

let cached: { userEmail: string; orgId?: string } | null | undefined;

export async function getOwnerCtx() {
  if (cached !== undefined) return cached;
  // guard:allow-env-credential — single-workspace deployment config (the one workspace owner), not a per-user credential
  const email = process.env.WORKSPACE_OWNER_EMAIL?.trim().toLowerCase();
  if (!email) {
    cached = null;
    return null;
  }
  try {
    const orgId = await resolveOrgIdForEmail(email);
    cached = { userEmail: email, orgId: orgId ?? undefined };
  } catch {
    cached = { userEmail: email };
  }
  return cached;
}
