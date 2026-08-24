import { defineEventHandler } from "h3";
import { getOAuthAccounts, getSession } from "@agent-native/core/server";

export default defineEventHandler(async (event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    // guard:allow-env-credential — this workspace's own Zoom OAuth app registration (client id), not a per-user credential
    return { connected: false, accounts: [] as { email: string }[], configured: !!process.env.ZOOM_CLIENT_ID };
  }
  const accounts = await getOAuthAccounts("zoom", session.email);
  const connected = accounts.some(
    (a) => Object.keys(a.tokens ?? {}).length > 0,
  );
  return {
    connected,
    accounts: accounts.map((a) => ({ email: a.accountId })),
    // guard:allow-env-credential — this workspace's own Zoom OAuth app registration (client id), not a per-user credential
    configured: !!process.env.ZOOM_CLIENT_ID,
  };
});
