import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { personas } from "../server/db/schema.js";
import { encodePersonaCriteria } from "../server/helpers/persona-sync.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Update a core persona's name, color, description, document text (replacing its criteria), or its linked li-agent persona (for LinkedIn-leg pool pulls in prospect pull plans).",
  schema: z.object({
    id: z.string().min(1),
    name: z.string().nullish(),
    color: z.string().nullish(),
    description: z.string().nullish(),
    text: z.string().nullish().describe("New document text to replace the persona's criteria"),
    liAgentPersonaId: z
      .string()
      .nullish()
      .describe("Id of the matching persona in li-agent's icpPersonas table, or null to unlink"),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ id, name, color, description, text, liAgentPersonaId }, ctx) => {
    await requireRole(ctx?.userEmail, ["admin"]);
    const db = getDb();

    const existing = await db.select({ id: personas.id }).from(personas).where(eq(personas.id, id)).limit(1);
    if (!existing[0]) {
      throw Object.assign(new Error(`Persona ${id} not found.`), { statusCode: 404 });
    }

    await db
      .update(personas)
      .set({
        ...(name ? { name } : {}),
        ...(color ? { color } : {}),
        ...(description !== undefined && description !== null ? { description } : {}),
        ...(text ? { criteria: encodePersonaCriteria(text) } : {}),
        ...(liAgentPersonaId !== undefined ? { liAgentPersonaId: liAgentPersonaId ?? null } : {}),
      })
      .where(eq(personas.id, id));

    return { id };
  },
});
