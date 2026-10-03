import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  approveFirstTouch,
  SendRefused,
} from "../server/lib/first-touch-send.js";
import { gmailClient } from "../server/lib/gmail.js";
import { newId, now, repo } from "../server/lib/pa-context.js";

export default defineAction({
  description:
    "People only, never the agent (D96). The lead's owner approves the current first-touch draft: mode send sends it from their own Gmail, mode gmail_draft saves it to their Gmail Drafts. Refuses anyone but the owner, a stale or failing draft, unfilled placeholders, a lead HubSpot moved on, and any second send for the lead. Writes nothing to HubSpot.",
  schema: z.object({
    engagementId: z.string().min(1),
    draftId: z.string().min(1),
    mode: z.enum(["send", "gmail_draft"]),
  }),
  agentTool: false,
  mcpTool: false,
  audit: {
    target: (args: { engagementId: string }) => ({
      type: "pa-engagement",
      id: args.engagementId,
    }),
    summary: (args: { engagementId: string; mode: string }) =>
      args.mode === "send"
        ? `Approved and sent the first touch on ${args.engagementId} from Gmail`
        : `Approved the first touch on ${args.engagementId} to Gmail Drafts`,
  },
  run: async (args, ctx) => {
    if (ctx?.caller === "tool")
      fail("Only a person can approve a send.", { statusCode: 403 });
    const email = ctx?.userEmail?.toLowerCase();
    if (!email) fail("Sign in first", { statusCode: 401 });
    try {
      return await approveFirstTouch(
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
