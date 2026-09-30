import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { OVERRIDABLE_ROUTES } from "../server/core/lead-route/index.js";
import { canEditHandbook } from "../server/lib/handbook-service.js";
import { wakeInboundAgent } from "../server/lib/live-pipeline.js";
import { now, repo } from "../server/lib/pa-context.js";

export default defineAction({
  description:
    "People only. Change who takes the meeting on one lead (D66): route to the AE, the PA takes the call, or qualify first. Pass route null to go back to the playbook's route. The draft is rewritten for the new route; nothing is sent or written to HubSpot.",
  schema: z.object({
    engagementId: z.string().min(1),
    route: z.enum(OVERRIDABLE_ROUTES).nullable(),
    note: z.string().trim().max(500).nullable().optional(),
  }),
  agentTool: false,
  audit: {
    target: (args: { engagementId: string }) => ({
      type: "pa-engagement",
      id: args.engagementId,
    }),
    summary: (args: { engagementId: string; route: string | null }) =>
      `Set the route on ${args.engagementId} to ${args.route ?? "the playbook's"}`,
  },
  run: async (args, ctx) => {
    const email = ctx?.userEmail?.toLowerCase();
    if (!email) fail("Sign in first", { statusCode: 401 });
    if (!(await canEditHandbook(ctx)))
      fail("Changing a route needs a PA role or app owner access.", {
        statusCode: 403,
      });
    const repository = repo();
    const engagement = await repository.getEngagement(args.engagementId);
    if (!engagement) fail("Lead not found", { statusCode: 404 });
    if (args.route === null) await repository.clearRouteOverride(engagement.id);
    else
      await repository.setRouteOverride({
        engagementId: engagement.id,
        route: args.route,
        note: args.note ?? null,
        setBy: email,
        setAt: now().toISOString(),
      });
    // The draft no longer matches the route, so the agent rewrites it.
    const agent = await wakeInboundAgent({
      userEmail: email,
      orgId: ctx?.orgId,
    });
    return { route: args.route, agent, sent: false, crmWritten: false };
  },
});
