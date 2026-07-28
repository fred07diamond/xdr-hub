import { defineEventHandler } from "h3";
import { getOAuthAccounts, getSession } from "@agent-native/core/server";

export default defineEventHandler(async (event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    return {
      connected: false,
      accounts: [] as { email: string }[],
      configured: !!process.env.NOOKS_CLIENT_ID,
    };
  }
  const accounts = await getOAuthAccounts("nooks", session.email);
  const connected = accounts.some((a) => Object.keys(a.tokens ?? {}).length > 0);
  return {
    connected,
    accounts: accounts.map((a) => ({ email: a.accountId })),
    configured: !!process.env.NOOKS_CLIENT_ID,
  };
});
