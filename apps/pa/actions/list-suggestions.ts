import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  SUGGESTION_AUDIENCES,
  SUGGESTION_STATUSES,
  type SuggestionAudience,
} from "../server/core/repo/types.js";
import { repo } from "../server/lib/pa-context.js";
import { actorOf, teamDirectory } from "../server/lib/playbook-service.js";

export default defineAction({
  description:
    "Suggestions raised by playbook changes and the agent: features for the app owner, CRM fields for RevOps, knowledge and playbook changes for the PA team. Defaults to the viewer's own audiences and open items.",
  schema: z.object({
    audience: z
      .array(z.enum(SUGGESTION_AUDIENCES))
      .optional()
      .describe("Defaults to the viewer's audiences"),
    status: z.array(z.enum(SUGGESTION_STATUSES)).default(["open"]),
    limit: z.number().int().min(1).max(200).default(100),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args, ctx) => {
    const actor = actorOf(ctx);
    const directory = teamDirectory(ctx);
    const [role, isAppOwner] = await Promise.all([
      directory.teamOf(actor.email),
      directory.isAppOwner(actor.email),
    ]);
    const mine: SuggestionAudience[] = isAppOwner
      ? [...SUGGESTION_AUDIENCES]
      : role
        ? [role]
        : [];
    const audiences = args.audience ?? mine;
    const suggestions = await repo().listSuggestions({
      audiences,
      statuses: args.status,
      limit: args.limit,
    });
    return { viewer: { role, isAppOwner, audiences: mine }, suggestions };
  },
});
