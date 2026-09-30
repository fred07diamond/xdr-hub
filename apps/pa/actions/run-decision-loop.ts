import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { ensureDecisionFor } from "../server/lib/decisions.js";
import { canEditHandbook } from "../server/lib/handbook-service.js";
import { repo } from "../server/lib/pa-context.js";

export default defineAction({
  description:
    "Run the rep decision loop for leads that do not have a decision yet (leads triaged before the loop existed): each qualifying lead gets PA's recommendation and a 24 hour decision deadline. New leads get this automatically.",
  schema: z.object({}),
  audit: {
    target: () => ({ type: "pa-decisions", id: "backfill" }),
    summary: () => "Ran the decision loop for older leads",
  },
  run: async (_args, ctx) => {
    if (!ctx?.userEmail) fail("Sign in first", { statusCode: 401 });
    if (!(await canEditHandbook(ctx)))
      fail("This needs a PA role or app owner access.", { statusCode: 403 });
    const repository = repo();
    let created = 0;
    let skipped = 0;
    for (const engagement of await repository.listEngagements()) {
      const existed = await repository.getDecision(engagement.id);
      if (existed) continue;
      const decision = await ensureDecisionFor(engagement.id, {
        dueFrom: "now",
      });
      if (decision) created += 1;
      else skipped += 1;
    }
    return { created, notNeeded: skipped };
  },
});
