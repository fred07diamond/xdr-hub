import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { now, repo } from "../server/lib/pa-context.js";

export default defineAction({
  description:
    "Mark the agent review of a published change as done, with how many suggestions it recorded. Used by the pa-playbook-review automation after it reads the release diff.",
  schema: z.object({
    changeId: z.string().min(1),
    suggestionsRecorded: z.number().int().min(0),
  }),
  audit: {
    target: (args: { changeId: string }) => ({
      type: "pa-playbook-change",
      id: args.changeId,
      visibility: "org" as const,
    }),
    summary: () => "Completed the agent review of a published change",
  },
  run: async (args) => {
    const repository = repo();
    const change = await repository.getChange(args.changeId);
    if (!change) fail("Playbook change not found", { statusCode: 404 });
    if (change.status !== "published")
      fail("Only published changes are reviewed", { statusCode: 409 });
    const at = now().toISOString();
    const updated = await repository.updateChange(
      change.id,
      {
        checks: {
          ...(change.checks ?? {}),
          agentReviewedAt: at,
          agentSuggestions: args.suggestionsRecorded,
        },
        updatedAt: at,
      },
      change.version,
    );
    return { change: updated };
  },
});
