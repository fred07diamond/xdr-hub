import { defineAction } from "@agent-native/core";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getSharedDb, sharedPersonaDocs } from "@xdr-hub/shared/server";
import { resolveOwnerStrict } from "../server/helpers/resolve-owner.js";

// Metadata only -- never returns document `text`. The full text is only ever
// read server-side (rebuildPersonaCriteriaText -> the persona's derived
// criteria text), so there's no reason to ship whole ICP documents down to a
// side panel or a browser.
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

    const sharedDb = getSharedDb();
    const docs = await sharedDb
      .select({
        id: sharedPersonaDocs.id,
        fileName: sharedPersonaDocs.fileName,
        wordCount: sharedPersonaDocs.wordCount,
        sortOrder: sharedPersonaDocs.sortOrder,
        createdAt: sharedPersonaDocs.createdAt,
      })
      .from(sharedPersonaDocs)
      .where(eq(sharedPersonaDocs.personaId, personaId))
      .orderBy(asc(sharedPersonaDocs.sortOrder), asc(sharedPersonaDocs.createdAt));

    return { documents: docs.map((d) => ({ id: d.id, name: d.fileName, wordCount: d.wordCount, sortOrder: d.sortOrder, createdAt: d.createdAt })) };
  },
});
