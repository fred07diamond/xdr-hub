import { defineAction } from "@agent-native/core";
import { desc, eq } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { subPersonas } from "../server/db/schema.js";
import { decodePersonaCriteria } from "../server/helpers/persona-sync.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "List sub-personas under a core persona, with a word count derived from their synced criteria text.",
  schema: z.object({ personaId: z.string().min(1) }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ personaId }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();
    const rows = await db
      .select({
        id: subPersonas.id,
        personaId: subPersonas.personaId,
        name: subPersonas.name,
        criteria: subPersonas.criteria,
        ownerEmail: subPersonas.ownerEmail,
        createdAt: subPersonas.createdAt,
      })
      .from(subPersonas)
      .where(eq(subPersonas.personaId, personaId))
      .orderBy(desc(subPersonas.createdAt));

    return {
      subPersonas: rows.map((s) => {
        const rawText = decodePersonaCriteria(s.criteria);
        return {
          id: s.id,
          personaId: s.personaId,
          name: s.name,
          wordCount: rawText ? rawText.split(/\s+/).filter(Boolean).length : 0,
          ownerEmail: s.ownerEmail,
          createdAt: s.createdAt,
        };
      }),
    };
  },
});
