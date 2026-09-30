import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { importDocs, MAX_IMPORT_FILES } from "../server/core/handbook/index.js";
import {
  handbookDeps,
  handbookOrFail,
  requireHandbookEditor,
} from "../server/lib/handbook-service.js";

export default defineAction({
  description:
    "People only. Import Markdown files into the Sales handbook. New files become docs; a file whose doc already exists replaces it, keeping the old version in history.",
  schema: z.object({
    files: z
      .array(
        z.object({
          name: z.string().min(1).max(200),
          content: z.string().max(400_000),
        }),
      )
      .min(1)
      .max(MAX_IMPORT_FILES),
    source: z
      .string()
      .max(200)
      .nullable()
      .optional()
      .describe("Where the files came from, shown on each doc"),
  }),
  agentTool: false,
  audit: {
    target: () => ({ type: "pa-handbook", id: "import" }),
    summary: (args: { files: Array<{ name: string }> }) =>
      `Imported ${args.files.length} handbook files`,
  },
  run: async (args, ctx) => {
    const actor = await requireHandbookEditor(ctx);
    return handbookOrFail(() =>
      importDocs(handbookDeps(), {
        actor,
        files: args.files,
        source: args.source ?? null,
      }),
    );
  },
});
