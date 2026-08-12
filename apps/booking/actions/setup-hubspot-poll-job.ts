import { defineAction } from "@agent-native/core";
import { resourcePut } from "@agent-native/core/resources";
import { z } from "zod";
import { requireRole } from "../server/helpers/require-role.js";

const JOB_RESOURCE_PATH = "jobs/poll-hubspot-contact-sales.md";

// One-time (idempotent -- re-running just overwrites the same resource path)
// provisioning for the fixed 2-hourly HubSpot Contact Sales poll. Not per-user
// like prospecting-hub's sourcing-rule jobs -- there's exactly one of these
// for the whole workspace, so it's a standalone action rather than something
// wired into a "create rule" UI flow.
//
// The job auto-actions every new lead it finds (calls generate-lead-outreach
// per lead) rather than just recording them for manual review. Each
// generate-lead-outreach call stays its own short tool call -- looping them
// as separate calls inside the job's own longer-lived run, instead of doing
// the looping inside poll-hubspot-contact-sales itself, keeps that action
// fast enough to stay safe if it's ever invoked directly/synchronously
// (e.g. manual testing via a browser fetch) instead of only from this job.
export default defineAction({
  description: "[setup] Create or reset the 2-hourly HubSpot Contact Sales poll + auto-action job.",
  schema: z.object({}),
  requiresAuth: true,
  agentTool: false,
  http: { method: "POST" },
  run: async (_args, ctx) => {
    await requireRole(ctx?.userEmail, ["admin"]);

    const jobContent = `---
schedule: "0 */2 * * *"
enabled: true
createdBy: ${ctx!.userEmail}
runAs: creator
---
Call the poll-hubspot-contact-sales action with no arguments. It returns { newLeadsFound, newLeadIds }.

If newLeadIds is empty, report "0 new leads" and stop.

Otherwise, for each id in newLeadIds, call the generate-lead-outreach action with { leadId: id } -- one separate call per id, in order. If a call for one id fails, note it and continue with the remaining ids rather than stopping.

When done, report in one short sentence: how many new leads were found and how many were successfully actioned. Do not call any other action or make any other tool call.
`;

    await resourcePut(ctx!.userEmail, JOB_RESOURCE_PATH, jobContent, "text/markdown");

    return { ok: true, jobResourcePath: JOB_RESOURCE_PATH };
  },
});
