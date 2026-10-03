import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { sendTestToSelf, SendRefused } from "../server/lib/first-touch-send.js";
import { gmailClient } from "../server/lib/gmail.js";
import { canEditHandbook } from "../server/lib/handbook-service.js";
import { newId, now, repo } from "../server/lib/pa-context.js";

export default defineAction({
  description:
    "People only, never the agent (D97). Sends a lead's current draft to the signed-in person's own inbox from their own Gmail, to try sending on any lead. Never emails the lead or the AE and never marks the lead contacted.",
  schema: z.object({
    engagementId: z.string().min(1),
    draftId: z.string().min(1),
  }),
  agentTool: false,
  mcpTool: false,
  audit: {
    target: (args: { engagementId: string }) => ({
      type: "pa-engagement",
      id: args.engagementId,
    }),
    summary: (args: { engagementId: string }) =>
      `Sent a test of the draft on ${args.engagementId} to themselves`,
  },
  run: async (args, ctx) => {
    if (ctx?.caller === "tool")
      fail("Only a person can send a test.", { statusCode: 403 });
    const email = ctx?.userEmail?.toLowerCase();
    if (!email) fail("Sign in first", { statusCode: 401 });
    if (!(await canEditHandbook(ctx)))
      fail("Sending a test needs a PA role or app owner access.", {
        statusCode: 403,
      });
    try {
      return await sendTestToSelf(
        { repository: repo(), gmail: gmailClient, now, newId },
        { ...args, actorEmail: email },
      );
    } catch (error) {
      if (error instanceof SendRefused)
        fail(error.message, {
          statusCode: error.statusCode,
          errorCode: error.code,
        });
      throw error;
    }
  },
});
