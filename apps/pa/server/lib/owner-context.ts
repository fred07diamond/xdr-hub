// The workspace owner's identity for background work (D35, D58). The poll has
// no signed-in user, but HubSpot credentials and the inbound agent are
// scoped to the organization, so background work runs as the owner.
import { resolveOrgIdForEmail } from "@agent-native/core/org";
import { getSetting, putSetting } from "@agent-native/core/settings";

const ORG_SETTING = "pa:workspace-org";

export interface OwnerCtx {
  userEmail: string;
  orgId?: string;
}

let cached: OwnerCtx | null = null;

/**
 * Remembers the workspace organization from a signed-in request, so the
 * background poll can act for it even when the owner lookup finds nothing.
 */
export async function rememberWorkspaceOrg(orgId: string | null | undefined) {
  if (!orgId) return;
  try {
    const current = await getSetting(ORG_SETTING);
    if (current?.orgId !== orgId)
      await putSetting(ORG_SETTING, { orgId, at: new Date().toISOString() });
  } catch (error) {
    console.warn(
      "[pa] Could not remember the workspace org:",
      error instanceof Error ? error.message : error,
    );
  }
}

export async function getOwnerCtx(): Promise<OwnerCtx | null> {
  // Only a complete identity is cached; a miss is retried next minute.
  if (cached?.orgId) return cached;
  // guard:allow-env-credential — single-workspace deployment config (the one workspace owner), not a per-user credential
  const email = process.env.WORKSPACE_OWNER_EMAIL?.trim().toLowerCase();
  if (!email) return null;
  let orgId: string | null = null;
  try {
    orgId = await resolveOrgIdForEmail(email);
  } catch (error) {
    console.warn(
      "[pa] Owner org lookup failed:",
      error instanceof Error ? error.message : error,
    );
  }
  if (!orgId) {
    try {
      const remembered = await getSetting(ORG_SETTING);
      orgId = typeof remembered?.orgId === "string" ? remembered.orgId : null;
    } catch {
      orgId = null;
    }
  }
  cached = { userEmail: email, ...(orgId ? { orgId } : {}) };
  return cached;
}
