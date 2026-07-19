import { defineAction } from "@agent-native/core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icpPersonas } from "../server/db/schema.js";
import { requireAdmin } from "../server/helpers/require-admin.js";

function extractSummary(text: string): string {
  const first = text.split(/\n\n/)[0]?.trim() ?? "";
  return first.length > 220 ? first.slice(0, 217) + "…" : first;
}

export default defineAction({
  description: "Create a new ICP persona with a name, color, and document text.",
  schema: z.object({
    name: z.string().min(1).max(80),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#6366f1"),
    icpText: z.string().min(1),
  }),
  run: async ({ name, color, icpText }, ctx) => {
    await requireAdmin(ctx);
    const db = getDb();
    const id = nanoid();
    const now = new Date().toISOString();
    const summary = extractSummary(icpText);
    const wordCount = icpText.split(/\s+/).filter(Boolean).length;

    await db.insert(icpPersonas).values({
      id,
      name,
      color,
      icpText,
      summary,
      isActive: 0,
      createdAt: now,
      updatedAt: now,
    });

    return { id, name, color, summary, wordCount };
  },
});
