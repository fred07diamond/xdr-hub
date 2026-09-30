import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { canEditHandbook } from "../server/lib/handbook-service.js";
import { queueRefreshAll } from "../server/lib/live-pipeline.js";

export default defineAction({
  description:
    "People only. Queue every undecided live lead for a refresh from HubSpot, so older leads get the same triage, class, brief, draft, and decision as new ones. The minute poll works through the queue a batch at a time. Decided leads are left as they are.",
  schema: z.object({}),
  agentTool: false,
  audit: {
    target: () => ({ type: "pa-intake", id: "refresh-all" }),
    summary: () => "Queued all undecided leads for a refresh",
  },
  run: async (_args, ctx) => {
    if (!ctx?.userEmail) fail("Sign in first", { statusCode: 401 });
    if (!(await canEditHandbook(ctx)))
      fail("Refreshing leads needs a PA role or app owner access.", {
        statusCode: 403,
      });
    return { queued: await queueRefreshAll() };
  },
});
