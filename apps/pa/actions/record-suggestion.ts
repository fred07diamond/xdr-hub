import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  SUGGESTION_AUDIENCES,
  SUGGESTION_KINDS,
} from "../server/core/repo/types.js";
import { newId, now, repo } from "../server/lib/pa-context.js";
import { deliverSuggestions } from "../server/lib/suggestion-delivery.js";

export default defineAction({
  description:
    "Record one suggestion for a person to decide: a feature for the app owner (kind feature, audience app_owner, include a short spec), a CRM field for RevOps (crm_field, revops), a board reorganization (view), a playbook change or knowledge gap (playbook or knowledge, pa_team or revops). Deduped on dedupeKey. Suggestions never change the app, the playbook, or the CRM by themselves.",
  schema: z.object({
    kind: z.enum(SUGGESTION_KINDS),
    audience: z.enum(SUGGESTION_AUDIENCES),
    title: z.string().min(3).max(140),
    body: z
      .string()
      .min(3)
      .max(4000)
      .describe(
        "What and why, citing the entry ids, release, or corrections it rests on",
      ),
    dedupeKey: z
      .string()
      .min(3)
      .max(200)
      .describe("Stable key, e.g. view:board.segment_column"),
    evidence: z.record(z.string(), z.unknown()).default({}),
    releaseId: z.string().optional(),
    changeId: z.string().optional(),
  }),
  audit: {
    target: (args: { dedupeKey: string }) => ({
      type: "pa-suggestion",
      id: args.dedupeKey,
      visibility: "org" as const,
    }),
    summary: (args: { title: string }) => `Suggested: ${args.title}`,
  },
  run: async (args, ctx) => {
    if (!ctx?.userEmail)
      fail("Sign in to record a suggestion", { statusCode: 401 });
    const repository = repo();
    const at = now().toISOString();
    const source =
      ctx.caller === "tool" || ctx.caller === "automation"
        ? ("agent" as const)
        : ("check" as const);
    const { record, inserted } = await repository.recordSuggestion({
      id: newId(),
      kind: args.kind,
      audience: args.audience,
      title: args.title,
      body: args.body,
      evidence: args.evidence,
      source,
      releaseId: args.releaseId ?? null,
      changeId: args.changeId ?? null,
      dedupeKey: `${source}:${args.dedupeKey}`,
      status: "open",
      decidedBy: null,
      decidedAt: null,
      notifiedAt: null,
      version: 1,
      createdAt: at,
      updatedAt: at,
    });
    if (inserted)
      await deliverSuggestions(repository, [record], ctx.orgId ?? null, now);
    return { suggestion: record, inserted };
  },
});
