import { resolveOrgIdForEmail } from "@agent-native/core/org";

// Resolved once on first use — avoids a per-request DB round-trip for LLM attribution.
let _ownerCtx: { userEmail: string; orgId?: string } | null | undefined = undefined;

export async function getOwnerCtx() {
  if (_ownerCtx !== undefined) return _ownerCtx;
  // guard:allow-env-credential — single-workspace deployment config (the one workspace owner), not a per-user credential
  const email = process.env.WORKSPACE_OWNER_EMAIL;
  if (!email) { _ownerCtx = null; return null; }
  try {
    const orgId = await resolveOrgIdForEmail(email);
    _ownerCtx = { userEmail: email, orgId: orgId ?? undefined };
  } catch {
    _ownerCtx = { userEmail: email };
  }
  return _ownerCtx;
}
