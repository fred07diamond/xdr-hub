import { defineAction } from "@agent-native/core";
import { deleteOAuthTokens } from "@agent-native/core/oauth-tokens";
import { z } from "zod";

export default defineAction({
  description: "Disconnect the current user's Nooks integration.",
  schema: z.object({}),
  requiresAuth: true,
  agentTool: false,
  http: { method: "POST" },
  run: async (_args, ctx) => {
    const accounts = await import("@agent-native/core/server").then((m) =>
      m.getOAuthAccounts("nooks", ctx!.userEmail),
    );
    for (const account of accounts) {
      await deleteOAuthTokens("nooks", account.accountId, ctx!.userEmail);
    }
    return { disconnected: true };
  },
});
