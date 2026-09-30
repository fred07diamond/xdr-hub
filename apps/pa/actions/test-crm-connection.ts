import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  storedCrmToken,
  testHubSpotToken,
} from "../server/lib/crm-connections.js";
import { requireOwnerInPerson } from "../server/lib/playbook-service.js";

export default defineAction({
  description:
    "App owner only: test the stored CRM token with a read-only call.",
  schema: z.object({ provider: z.enum(["hubspot"]) }),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  run: async (args, ctx) => {
    await requireOwnerInPerson(ctx, "Testing a CRM connection");
    const token = await storedCrmToken(args.provider, ctx?.orgId ?? null);
    if (!token) fail("No token is saved", { statusCode: 404 });
    return testHubSpotToken(token);
  },
});
