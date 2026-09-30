import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { saveDoc } from "../server/core/handbook/index.js";
import {
  handbookDeps,
  handbookOrFail,
  requireHandbookEditor,
} from "../server/lib/handbook-service.js";

export default defineAction({
  description:
    "People only. Save an edit to a Sales handbook doc. The prior version is kept; a stale expectedVersion is refused so two editors cannot overwrite each other.",
  schema: z.object({
    id: z.string().min(1),
    expectedVersion: z.number().int().min(1),
    title: z.string().max(200).optional(),
    summary: z.string().max(400).nullable().optional(),
    status: z.enum(["index", "current", "legacy"]).optional(),
    body: z.string().min(1),
    note: z.string().max(300).nullable().optional(),
  }),
  agentTool: false,
  audit: {
    target: (args: { id: string }) => ({
      type: "pa-handbook-doc",
      id: args.id,
    }),
    summary: (args: { id: string }) => `Edited handbook doc ${args.id}`,
  },
  run: async (args, ctx) => {
    const actor = await requireHandbookEditor(ctx);
    const doc = await handbookOrFail(() =>
      saveDoc(handbookDeps(), { ...args, actor }),
    );
    return { id: doc.id, version: doc.version, updatedAt: doc.updatedAt };
  },
});
