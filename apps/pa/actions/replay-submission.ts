import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  replaySyntheticCases,
  syntheticCases,
} from "../server/core/replay/index.js";
import {
  activeRelease,
  canReplaySynthetic,
  isPaAdmin,
  newId,
  now,
  repo,
} from "../server/lib/pa-context.js";

const CASE_IDS = syntheticCases.map((item) => item.id);

export default defineAction({
  description:
    "Admin. Replay the synthetic Contact Sales cases (or one case) through the pipeline in shadow mode against the current playbook release, then compare pre-check, route, and verdict with each case's expected labels. Idempotent: replaying twice creates no duplicates. No sends, no CRM writes.",
  schema: z.object({
    caseId: z
      .string()
      .optional()
      .describe(
        `One synthetic case id: ${CASE_IDS.join(", ")}. Omit to replay all.`,
      ),
  }),
  toolCallable: false,
  authorize: async (_args, ctx) => {
    const userId = ctx?.userEmail ?? null;
    if (!canReplaySynthetic(userId, await isPaAdmin(userId))) {
      throw new Error("Replays need the workspace admin role.");
    }
  },
  audit: {
    target: (args: { caseId?: string }) => ({
      type: "pa-replay",
      id: args.caseId ?? "synthetic-set",
    }),
    summary: (args: { caseId?: string }) =>
      `Replayed ${args.caseId ?? "all synthetic cases"} in shadow`,
  },
  run: async (args, ctx) => {
    const release = await activeRelease();
    const results = await replaySyntheticCases({
      repo: repo(),
      release: release,
      now,
      newId,
      caseId: args.caseId,
      linkUserId: ctx?.userEmail ?? null,
    });
    const agree = results.filter(
      (item) =>
        item.matches.precheck && item.matches.route && item.matches.verdict,
    ).length;
    return {
      mode: "shadow" as const,
      releaseShortId: release.short_id,
      summary: {
        total: results.length,
        agreeWithLabels: agree,
        failed: results.filter((item) => item.pipeline !== "done").length,
      },
      results,
    };
  },
});
