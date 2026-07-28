import { defineAction } from "@agent-native/core";
import { deleteOAuthTokens } from "@agent-native/core/oauth-tokens";
import { z } from "zod";

export default defineAction({
  description: "Disconnect the current user's Google Calendar integration.",
  schema: z.object({}),
  requiresAuth: true,
  agentTool: false,
  http: { method: "POST" },
  run: async (_args, ctx) => {
    const accounts = await import("@agent-native/core/server").then((m) =>
      m.getOAuthAccounts("google", ctx!.userEmail),
    );
    for (const account of accounts) {
      await deleteOAuthTokens("google", account.accountId, ctx!.userEmail);
    }
    return { disconnected: true };
  },
});
