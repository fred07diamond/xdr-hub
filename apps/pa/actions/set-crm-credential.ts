import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  saveCrmToken,
  testHubSpotToken,
} from "../server/lib/crm-connections.js";
import { requireOwnerInPerson } from "../server/lib/playbook-service.js";

export default defineAction({
  description:
    "App owner only, in person: save a CRM access token. It is tested with a read-only call first, then stored encrypted at org scope, where every xDR Hub app reads it. The value is never returned or logged.",
  schema: z.object({
    provider: z.enum(["hubspot"]),
    token: z.string().min(10).max(400),
  }),
  agentTool: false,
  audit: {
    // Inputs stay out of the audit log: only which provider changed.
    recordInputs: false,
    target: (args: { provider: string }) => ({
      type: "pa-crm-connection",
      id: args.provider,
      visibility: "org" as const,
    }),
    summary: (args: { provider: string }) =>
      `Saved the ${args.provider} CRM token`,
  },
  run: async (args, ctx) => {
    await requireOwnerInPerson(ctx, "Saving a CRM token");
    if (!ctx?.orgId)
      fail("CRM tokens are saved for an organization; this session has none", {
        statusCode: 409,
      });
    const token = args.token.trim();
    const test = await testHubSpotToken(token);
    if (!test.ok) fail(`Not saved: ${test.message}`, { statusCode: 422 });
    await saveCrmToken(args.provider, ctx.orgId, token);
    return { saved: true, message: test.message, last4: token.slice(-4) };
  },
});
