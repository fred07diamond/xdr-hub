import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icps } from "../server/db/schema.js";
import { encodePersonaCriteria } from "../server/helpers/persona-sync.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Update an ICP's name, color, product, or document text (replacing its criteria).",
  schema: z.object({
    id: z.string().min(1),
    name: z.string().nullish(),
    color: z.string().nullish(),
    product: z.string().nullish(),
    text: z.string().nullish().describe("New document text to replace the ICP's criteria"),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ id, name, color, product, text }, ctx) => {
    await requireRole(ctx?.userEmail, ["admin"]);
    const db = getDb();

    const existing = await db.select({ id: icps.id }).from(icps).where(eq(icps.id, id)).limit(1);
    if (!existing[0]) {
      throw Object.assign(new Error(`ICP ${id} not found.`), { statusCode: 404 });
    }

    await db
      .update(icps)
      .set({
        ...(name ? { name } : {}),
        ...(color ? { color } : {}),
        ...(product !== undefined && product !== null ? { product } : {}),
        ...(text ? { criteria: encodePersonaCriteria(text) } : {}),
      })
      .where(eq(icps.id, id));

    return { id };
  },
});
