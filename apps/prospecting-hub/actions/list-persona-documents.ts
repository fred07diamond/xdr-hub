import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { personaDocuments } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "List the files uploaded to a persona's knowledge base (name and upload date only, not full content).",
  schema: z.object({ personaId: z.string().min(1) }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ personaId }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();
    const rows = await db
      .select({
        id: personaDocuments.id,
        fileName: personaDocuments.fileName,
        createdAt: personaDocuments.createdAt,
      })
      .from(personaDocuments)
      .where(eq(personaDocuments.personaId, personaId))
      .orderBy(personaDocuments.createdAt);

    return { documents: rows };
  },
});
