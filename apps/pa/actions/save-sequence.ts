import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { canEditHandbook } from "../server/lib/handbook-service.js";
import { newId, now, repo } from "../server/lib/pa-context.js";
import { sequenceInputSchema } from "../shared/sequences.js";

export default defineAction({
  description:
    "People only (D105). Create a sequence, or save changes to one (pass id and the version you edited). Any PA can; changes apply now, to leads enrolled after the save.",
  schema: z.object({
    id: z.string().min(1).optional(),
    version: z.number().int().optional(),
    sequence: sequenceInputSchema,
  }),
  agentTool: false,
  mcpTool: false,
  audit: {
    target: (args: { id?: string }) => ({
      type: "pa-sequence",
      id: args.id ?? "new",
    }),
    summary: (args: { id?: string; sequence: { name: string } }) =>
      args.id
        ? `Edited the sequence ${args.sequence.name}`
        : `Created the sequence ${args.sequence.name}`,
  },
  run: async (args, ctx) => {
    if (ctx?.caller === "tool")
      fail("Only a person can edit sequences.", { statusCode: 403 });
    const email = ctx?.userEmail?.toLowerCase();
    if (!email) fail("Sign in first", { statusCode: 401 });
    if (!(await canEditHandbook(ctx)))
      fail("Editing sequences needs a PA role or app owner access.", {
        statusCode: 403,
      });
    const repository = repo();
    const at = now().toISOString();
    const data = args.sequence;
    if (!args.id) {
      const id = newId();
      await repository.insertSequence({
        id,
        ...data,
        createdBy: email,
        updatedBy: email,
        archived: false,
        version: 1,
        createdAt: at,
        updatedAt: at,
      });
      return { id, version: 1 };
    }
    const current = await repository.getSequence(args.id);
    if (!current) fail("Sequence not found", { statusCode: 404 });
    if (args.version !== undefined && args.version !== current.version)
      fail("Someone changed this sequence since you opened it. Reload it.", {
        statusCode: 409,
      });
    const saved = await repository.updateSequence(
      current.id,
      { ...data, updatedBy: email, updatedAt: at },
      current.version,
    );
    return { id: saved.id, version: saved.version };
  },
});
