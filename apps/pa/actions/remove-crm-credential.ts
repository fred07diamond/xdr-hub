import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { removeCrmToken } from "../server/lib/crm-connections.js";
import { requireOwnerInPerson } from "../server/lib/playbook-service.js";

export default defineAction({
  description:
    "App owner only, in person: remove the saved CRM token. Every xDR Hub app that reads it loses HubSpot access until a new one is saved.",
  schema: z.object({ provider: z.enum(["hubspot"]) }),
  agentTool: false,
  audit: {
    target: (args: { provider: string }) => ({
      type: "pa-crm-connection",
      id: args.provider,
      visibility: "org" as const,
    }),
    summary: (args: { provider: string }) =>
      `Removed the ${args.provider} CRM token`,
  },
  run: async (args, ctx) => {
    await requireOwnerInPerson(ctx, "Removing a CRM token");
    if (!ctx?.orgId)
      fail("This session has no organization", { statusCode: 409 });
    return { removed: await removeCrmToken(args.provider, ctx.orgId) };
  },
});
