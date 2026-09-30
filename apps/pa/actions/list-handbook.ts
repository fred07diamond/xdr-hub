import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { searchDocs } from "../server/core/handbook/index.js";
import { canEditHandbook } from "../server/lib/handbook-service.js";
import { repo } from "../server/lib/pa-context.js";

export default defineAction({
  description:
    "List the Sales handbook: PA's reference docs on the sales cycle, qualification, lead routing, personas, the email playbook, and sales stages. Pass `query` to search titles and text. Read a doc with get-handbook-doc. The handbook is reference; where it conflicts with the pinned playbook release, the playbook wins and the conflict is worth raising.",
  schema: z.object({
    query: z.string().max(200).optional().describe("Words to search for"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args, ctx) => {
    const docs = await repo().listHandbookDocs();
    return {
      canEdit: await canEditHandbook(ctx),
      docs: docs.map((doc) => ({
        id: doc.id,
        title: doc.title,
        summary: doc.summary,
        status: doc.status,
        position: doc.position,
        version: doc.version,
        updatedBy: doc.updatedBy,
        updatedAt: doc.updatedAt,
        words: doc.body.split(/\s+/).filter(Boolean).length,
      })),
      matches: args.query ? searchDocs(docs, args.query) : [],
    };
  },
});
