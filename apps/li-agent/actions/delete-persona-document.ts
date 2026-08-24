import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icpPersonaDocs } from "../server/db/schema.js";
import { rebuildPersonaIcpText } from "../server/helpers/persona-docs.js";
import { requireAdminFromSessionOrToken } from "../server/helpers/require-admin.js";

export default defineAction({
  description:
    "Remove one ICP document from a persona. The persona's combined ICP text is rebuilt from its remaining documents; removing the last one leaves the persona with no ICP text, which takes it out of persona matching until a document is added back.",
  schema: z.object({
    id: z.string().describe("id of the document to remove"),
    apiToken: z.string().nullish().describe("Personal API token — extension callers only"),
  }),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: false, requiresAuth: false },
  run: async ({ id, apiToken }, ctx) => {
    await requireAdminFromSessionOrToken(apiToken, ctx);
    const db = getDb();

    const row = await db
      .select({ personaId: icpPersonaDocs.personaId, name: icpPersonaDocs.name })
      .from(icpPersonaDocs)
      .where(eq(icpPersonaDocs.id, id))
      .limit(1);
    if (!row[0]) return { ok: false as const, error: "Document not found." };

    await db.delete(icpPersonaDocs).where(eq(icpPersonaDocs.id, id));
    const rebuilt = await rebuildPersonaIcpText(db, row[0].personaId);

    return {
      ok: true as const,
      removed: row[0].name,
      personaId: row[0].personaId,
      docCount: rebuilt.docCount,
      wordCount: rebuilt.wordCount,
    };
  },
});
