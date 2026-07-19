import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icpPersonas } from "../server/db/schema.js";
import { requireAdmin } from "../server/helpers/require-admin.js";

function extractSummary(text: string): string {
  const first = text.split(/\n\n/)[0]?.trim() ?? "";
  return first.length > 220 ? first.slice(0, 217) + "…" : first;
}

export default defineAction({
  description: "Update an ICP persona's name, color, or document text.",
  schema: z.object({
    id: z.string(),
    name: z.string().min(1).max(80).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    icpText: z.string().min(1).optional(),
  }),
  run: async ({ id, name, color, icpText }, ctx) => {
    await requireAdmin(ctx);
    const db = getDb();
    const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (name !== undefined) patch.name = name;
    if (color !== undefined) patch.color = color;
    if (icpText !== undefined) {
      patch.icpText = icpText;
      patch.summary = extractSummary(icpText);
    }
    await db.update(icpPersonas).set(patch).where(eq(icpPersonas.id, id));
    return { ok: true };
  },
});
