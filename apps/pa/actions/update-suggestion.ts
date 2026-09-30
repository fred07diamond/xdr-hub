import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { repo, now } from "../server/lib/pa-context.js";
import { actorOf, teamDirectory } from "../server/lib/playbook-service.js";

export default defineAction({
  description:
    "People only: accept, dismiss, or mark done a suggestion addressed to you (or any, for the app owner). Accepting records intent; the work itself still happens through a playbook change, a CRM request, or a build.",
  schema: z.object({
    suggestionId: z.string().min(1),
    status: z.enum(["accepted", "dismissed", "done", "open"]),
  }),
  agentTool: false,
  audit: {
    target: (args: { suggestionId: string }) => ({
      type: "pa-suggestion",
      id: args.suggestionId,
      visibility: "org" as const,
    }),
    summary: (args: { status: string }) => `Marked a suggestion ${args.status}`,
  },
  run: async (args, ctx) => {
    const actor = actorOf(ctx);
    const repository = repo();
    const suggestion = await repository.getSuggestion(args.suggestionId);
    if (!suggestion) fail("Suggestion not found", { statusCode: 404 });
    const directory = teamDirectory(ctx);
    const [role, isAppOwner] = await Promise.all([
      directory.teamOf(actor.email),
      directory.isAppOwner(actor.email),
    ]);
    if (!isAppOwner && role !== suggestion.audience)
      fail("This suggestion is addressed to someone else", { statusCode: 403 });
    const at = now().toISOString();
    const updated = await repository.updateSuggestion(
      suggestion.id,
      {
        status: args.status,
        decidedBy: args.status === "open" ? null : actor.email,
        decidedAt: args.status === "open" ? null : at,
        updatedAt: at,
      },
      suggestion.version,
    );
    return { suggestion: updated };
  },
});
