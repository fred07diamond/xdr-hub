import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { gmailStatus } from "../server/lib/gmail.js";

export default defineAction({
  description:
    "People only: whether the signed-in person's Gmail is connected to PA for sending first touches (D96). Never returns a token.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  run: async (_args, ctx) => {
    const email = ctx?.userEmail?.toLowerCase();
    if (!email) fail("Sign in first", { statusCode: 401 });
    return { you: email, ...(await gmailStatus(email)) };
  },
});
