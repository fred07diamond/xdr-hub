import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { canEditHandbook } from "../server/lib/handbook-service.js";
import {
  refreshInbox,
  RefreshError,
  wakeInboundAgent,
} from "../server/lib/live-pipeline.js";
import { repo } from "../server/lib/pa-context.js";

export default defineAction({
  description:
    "People only. Refresh one live lead: re-read it from HubSpot (read-only) and run it through the current triage, classification, decision loop, brief, and draft, as a fresh lead. The old version is closed as refreshed and kept for history. Returns the new engagement id.",
  schema: z.object({ engagementId: z.string().min(1) }),
  agentTool: false,
  audit: {
    target: (args: { engagementId: string }) => ({
      type: "pa-engagement",
      id: args.engagementId,
    }),
    summary: (args: { engagementId: string }) =>
      `Refreshed ${args.engagementId} from HubSpot`,
  },
  run: async (args, ctx) => {
    const email = ctx?.userEmail?.toLowerCase();
    if (!email) fail("Sign in first", { statusCode: 401 });
    if (!(await canEditHandbook(ctx)))
      fail("Refreshing leads needs a PA role or app owner access.", {
        statusCode: 403,
      });
    const repository = repo();
    const submissions = await repository.listSubmissionsForEngagement(
      args.engagementId,
    );
    const latest = submissions[submissions.length - 1];
    if (!latest) fail("Lead not found", { statusCode: 404 });
    try {
      const result = await refreshInbox(latest.inboxId);
      const agent =
        result.status === "refreshed"
          ? await wakeInboundAgent({ userEmail: email, orgId: ctx?.orgId })
          : "skipped";
      return { ...result, agent };
    } catch (error) {
      if (error instanceof RefreshError)
        fail(error.message, { statusCode: error.statusCode });
      const message = error instanceof Error ? error.message : String(error);
      fail(`Couldn't read HubSpot: ${message}`, { statusCode: 502 });
    }
  },
});
