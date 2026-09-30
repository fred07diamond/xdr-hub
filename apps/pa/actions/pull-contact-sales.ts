import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { canEditHandbook } from "../server/lib/handbook-service.js";
import {
  listAgentWork,
  pullContactSales,
  wakeInboundAgent,
} from "../server/lib/live-pipeline.js";
import { repo } from "../server/lib/pa-context.js";

export default defineAction({
  description:
    "Pull recent Contact Sales submissions from HubSpot (read-only) and run each new one through the pipeline in shadow mode: pre-check, route, score, then the agent assesses the message and drafts a reply. Safe to repeat; a submission is taken in once. Nothing is sent and nothing is written to HubSpot.",
  schema: z.object({
    lookbackHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 14)
      .default(72)
      .describe("How far back to look for submissions"),
    limit: z.number().int().min(1).max(300).default(100),
  }),
  audit: {
    target: () => ({ type: "pa-intake", id: "hubspot" }),
    summary: (args: { lookbackHours: number }) =>
      `Pulled Contact Sales submissions from the last ${args.lookbackHours} hours`,
  },
  run: async (args, ctx) => {
    const email = ctx?.userEmail?.toLowerCase();
    if (!email) fail("Sign in to pull leads", { statusCode: 401 });
    // The app owner and PA role holders; the inbound agent runs as the owner.
    if (!(await canEditHandbook(ctx)))
      fail(
        "Pulling leads needs a PA role (PA team or RevOps) or app owner access.",
        { statusCode: 403 },
      );
    let result;
    try {
      result = await pullContactSales({
        lookbackHours: args.lookbackHours,
        limit: args.limit,
        actor: ctx?.caller === "tool" ? "agent:inbound" : `user:${email}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fail(`Couldn't read HubSpot: ${message}`, { statusCode: 502 });
    }
    const work = await listAgentWork(repo());
    const agent =
      work.length > 0 && ctx?.caller !== "tool"
        ? await wakeInboundAgent({ userEmail: email, orgId: ctx?.orgId })
        : "skipped";
    return { ...result, agentWork: work.length, agent };
  },
});
