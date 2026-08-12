import { defineAction } from "@agent-native/core";
import { resourcePut } from "@agent-native/core/resources";
import { z } from "zod";
import { requireRole } from "../server/helpers/require-role.js";

const JOB_RESOURCE_PATH = "jobs/poll-hubspot-contact-sales.md";

// One-time (idempotent -- re-running just overwrites the same resource path)
// provisioning for the fixed daily HubSpot Contact Sales poll. Not per-user
// like prospecting-hub's sourcing-rule jobs -- there's exactly one of these
// for the whole workspace, so it's a standalone action rather than something
// wired into a "create rule" UI flow.
export default defineAction({
  description: "[setup] Create or reset the daily 6am HubSpot Contact Sales poll job.",
  schema: z.object({}),
  requiresAuth: true,
  agentTool: false,
  http: { method: "POST" },
  run: async (_args, ctx) => {
    await requireRole(ctx?.userEmail, ["admin"]);

    const jobContent = `---
schedule: "0 6 * * *"
enabled: true
createdBy: ${ctx!.userEmail}
runAs: creator
---
Call the poll-hubspot-contact-sales action with no arguments. It returns { newLeadsFound }. Report that number in one short sentence. Do not call any other action or make any other tool call.
`;

    await resourcePut(ctx!.userEmail, JOB_RESOURCE_PATH, jobContent, "text/markdown");

    return { ok: true, jobResourcePath: JOB_RESOURCE_PATH };
  },
});
