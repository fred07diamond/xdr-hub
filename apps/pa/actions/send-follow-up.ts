import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { SendRefused } from "../server/lib/first-touch-send.js";
import { sendFollowUp } from "../server/lib/follow-up-send.js";
import {
  blockerNow,
  cadenceParams,
  routeLinkOf,
} from "../server/lib/follow-ups.js";
import { gmailClient } from "../server/lib/gmail.js";
import { activeRelease, newId, now, repo } from "../server/lib/pa-context.js";
import { cadenceSettings } from "../shared/cadence.js";

export default defineAction({
  description:
    "People only, never the agent (D101). The lead's owner sends one follow-up from their Gmail, as a reply in the first touch's thread. HubSpot is read first: if the lead replied, booked, or moved on, follow-ups stop and nothing is sent.",
  schema: z.object({ followUpId: z.string().min(1) }),
  agentTool: false,
  mcpTool: false,
  audit: {
    target: (args: { followUpId: string }) => ({
      type: "pa-follow-up",
      id: args.followUpId,
    }),
    summary: (args: { followUpId: string }) =>
      `Sent follow-up ${args.followUpId} from Gmail`,
  },
  run: async (args, ctx) => {
    if (ctx?.caller === "tool")
      fail("Only a person can send.", { statusCode: 403 });
    const email = ctx?.userEmail?.toLowerCase();
    if (!email) fail("Sign in first", { statusCode: 401 });
    const repository = repo();
    try {
      return await sendFollowUp(
        {
          repository,
          gmail: gmailClient,
          now,
          newId,
          // The fresh HubSpot check: a reply, meeting, bounce, or
          // out-of-office is applied (stop or pause) before refusing.
          stopReason: (engagementId) => blockerNow(repository, engagementId),
          stop: async () => 0,
          linkFor: (engagementId) => routeLinkOf(repository, engagementId),
          caps: cadenceSettings(cadenceParams(await activeRelease(repository))),
        },
        { followUpId: args.followUpId, actorEmail: email },
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
