import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { crmConnectionStatus } from "../server/lib/crm-connections.js";
import { requireOwnerInPerson } from "../server/lib/playbook-service.js";

export default defineAction({
  description:
    "App owner only: the CRM connections PA can use (HubSpot, Salesforce), with whether a token or OAuth connection is set, its last four characters, and when it changed. Never returns a credential.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  run: async (_args, ctx) => {
    await requireOwnerInPerson(ctx, "Viewing CRM connections");
    return {
      orgId: ctx?.orgId ?? null,
      providers: await crmConnectionStatus(ctx?.orgId ?? null),
    };
  },
});
