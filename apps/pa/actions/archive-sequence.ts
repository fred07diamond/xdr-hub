import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { canEditHandbook } from "../server/lib/handbook-service.js";
import { now, repo } from "../server/lib/pa-context.js";

export default defineAction({
  description:
    "People only (D105). Archive a sequence so no new lead is enrolled in it (leads already in it continue), or restore it.",
  schema: z.object({ id: z.string().min(1), archived: z.boolean() }),
  agentTool: false,
  mcpTool: false,
  audit: {
    target: (args: { id: string }) => ({ type: "pa-sequence", id: args.id }),
    summary: (args: { archived: boolean }) =>
      args.archived ? "Archived a sequence" : "Restored a sequence",
  },
  run: async (args, ctx) => {
    const email = ctx?.userEmail?.toLowerCase();
    if (!email || ctx?.caller === "tool")
      fail("Only a person can do this.", { statusCode: 403 });
    if (!(await canEditHandbook(ctx)))
      fail("This needs a PA role or app owner access.", { statusCode: 403 });
    const repository = repo();
    const current = await repository.getSequence(args.id);
    if (!current) fail("Sequence not found", { statusCode: 404 });
    await repository.updateSequence(
      current.id,
      {
        archived: args.archived,
        updatedBy: email,
        updatedAt: now().toISOString(),
      },
      current.version,
    );
    return { archived: args.archived };
  },
});
