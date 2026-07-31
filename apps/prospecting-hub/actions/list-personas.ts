import { defineAction } from "@agent-native/core";
import { desc } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { personas } from "../server/db/schema.js";
import { decodePersonaCriteria } from "../server/helpers/persona-sync.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "List core personas with name, color, description, and a word count derived from their synced document text.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_input, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();
    const rows = await db
      .select({
        id: personas.id,
        name: personas.name,
        color: personas.color,
        description: personas.description,
        sourceDocUrl: personas.sourceDocUrl,
        criteria: personas.criteria,
        ownerEmail: personas.ownerEmail,
        createdAt: personas.createdAt,
      })
      .from(personas)
      .orderBy(desc(personas.createdAt));

    return {
      personas: rows.map((p) => {
        const rawText = decodePersonaCriteria(p.criteria);
        return {
          id: p.id,
          name: p.name,
          color: p.color,
          description: p.description,
          sourceDocUrl: p.sourceDocUrl,
          wordCount: rawText ? rawText.split(/\s+/).filter(Boolean).length : 0,
          ownerEmail: p.ownerEmail,
          createdAt: p.createdAt,
        };
      }),
    };
  },
});
