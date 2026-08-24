import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { getSharedDb, sharedPersonaDocs } from "@xdr-hub/shared/server";
import { z } from "zod";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "List the files uploaded to a persona's knowledge base (name and upload date only, not full content).",
  schema: z.object({ personaId: z.string().min(1) }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ personaId }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const sharedDb = getSharedDb();
    const rows = await sharedDb
      .select({
        id: sharedPersonaDocs.id,
        fileName: sharedPersonaDocs.fileName,
        createdAt: sharedPersonaDocs.createdAt,
        wordCount: sharedPersonaDocs.wordCount,
      })
      .from(sharedPersonaDocs)
      .where(eq(sharedPersonaDocs.personaId, personaId))
      .orderBy(sharedPersonaDocs.sortOrder, sharedPersonaDocs.createdAt);

    return { documents: rows };
  },
});
