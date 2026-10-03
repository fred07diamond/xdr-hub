import { defineAction, fail } from "@agent-native/core/action";
import { deleteOAuthTokens } from "@agent-native/core/oauth-tokens";
import { z } from "zod";

import { GMAIL_PROVIDER } from "../server/lib/gmail.js";

export default defineAction({
  description:
    "People only: disconnect the signed-in person's own Gmail from PA (D96). PA can no longer send or save drafts as them.",
  schema: z.object({}),
  agentTool: false,
  mcpTool: false,
  audit: {
    target: () => ({ type: "pa-gmail", id: "self" }),
    summary: () => "Disconnected Gmail from PA",
  },
  run: async (_args, ctx) => {
    const email = ctx?.userEmail?.toLowerCase();
    if (!email) fail("Sign in first", { statusCode: 401 });
    const removed = await deleteOAuthTokens(GMAIL_PROVIDER, email, email);
    return { disconnected: removed > 0 };
  },
});
