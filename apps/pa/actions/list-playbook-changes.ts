import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { CHANGE_STATUSES } from "../server/core/repo/types.js";
import { repo } from "../server/lib/pa-context.js";

export default defineAction({
  description:
    "Playbook change sets, newest first, optionally filtered by status (draft, in_review, published, rejected, withdrawn).",
  schema: z.object({
    status: z.array(z.enum(CHANGE_STATUSES)).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const changes = await repo().listChanges({
      statuses: args.status,
      limit: args.limit,
    });
    return {
      changes: changes.map((change) => ({
        id: change.id,
        title: change.title,
        status: change.status,
        authorEmail: change.authorEmail,
        authorKind: change.authorKind,
        requiredTeams: change.requiredTeams,
        resultReleaseId: change.resultReleaseId,
        agentReviewedAt:
          (change.checks as { agentReviewedAt?: string } | null)
            ?.agentReviewedAt ?? null,
        updatedAt: change.updatedAt,
      })),
    };
  },
});
