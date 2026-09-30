import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { canEditHandbook } from "../server/lib/handbook-service.js";
import { repo } from "../server/lib/pa-context.js";

export default defineAction({
  description:
    "Read one Sales handbook doc in full (Markdown), with its revision history. Pass `version` for an earlier revision. Returns null when the id does not exist.",
  schema: z.object({
    id: z.string().min(1).describe("Doc id from list-handbook"),
    version: z.number().int().min(1).optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args, ctx) => {
    const repository = repo();
    const doc = await repository.getHandbookDoc(args.id);
    if (!doc) return null;
    const revisions = await repository.listHandbookRevisions(doc.id);
    const revision =
      args.version && args.version !== doc.version
        ? (revisions.find((item) => item.version === args.version) ?? null)
        : null;
    return {
      canEdit: await canEditHandbook(ctx),
      doc: revision
        ? { ...doc, title: revision.title, body: revision.body }
        : doc,
      viewingVersion: revision ? revision.version : doc.version,
      revisions: revisions.map((item) => ({
        version: item.version,
        editedBy: item.editedBy,
        note: item.note,
        createdAt: item.createdAt,
      })),
    };
  },
});
