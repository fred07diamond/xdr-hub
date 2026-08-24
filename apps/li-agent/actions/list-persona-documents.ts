import { defineAction } from "@agent-native/core";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icpPersonaDocs } from "../server/db/schema.js";
import { resolveOwnerStrict } from "../server/helpers/resolve-owner.js";

// Metadata only -- never returns document `text`. The full text is only ever
// read server-side (rebuildPersonaIcpText -> icpPersonas.icpText), so there's
// no reason to ship whole ICP documents down to a side panel or a browser.
export default defineAction({
  description:
    "List the ICP documents attached to a persona (names and word counts, not the document text).",
  schema: z.object({
    personaId: z.string(),
    apiToken: z.string().nullish().describe("Personal API token — extension callers only"),
  }),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: true, requiresAuth: false },
  http: { method: "GET" },
  readOnly: true,
  run: async ({ personaId, apiToken }, ctx) => {
    // Any workspace member may READ the persona setup (the ICP tab shows it
    // to non-admins too, read-only); a credential-free caller gets nothing.
    const email = await resolveOwnerStrict(apiToken, ctx);
    if (!email) return { documents: [] };

    const db = getDb();
    const documents = await db
      .select({
        id: icpPersonaDocs.id,
        name: icpPersonaDocs.name,
        wordCount: icpPersonaDocs.wordCount,
        sortOrder: icpPersonaDocs.sortOrder,
        createdAt: icpPersonaDocs.createdAt,
      })
      .from(icpPersonaDocs)
      .where(eq(icpPersonaDocs.personaId, personaId))
      .orderBy(asc(icpPersonaDocs.sortOrder), asc(icpPersonaDocs.createdAt));

    return { documents };
  },
});
