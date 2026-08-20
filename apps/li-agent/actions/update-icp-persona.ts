import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icpPersonas, leadListItems, postEngagements, prospects } from "../server/db/schema.js";
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

    // personaName/personaColor are DENORMALIZED onto every scored row
    // (prospects, leadListItems, postEngagements -- see selectPersonasBatch).
    // Without propagating a rename/recolor here, existing rows keep the old
    // name forever, and anything that groups by personaName rather than
    // personaId shows the same persona twice: Analytics' Personas chart
    // renders one bar per distinct name, so a rename silently split one
    // persona into an old bar plus a new bar. The Prospects/Lead Lists
    // persona filter pills are built the same way and duplicated too.
    const rowPatch: Record<string, unknown> = {};
    if (name !== undefined) rowPatch.personaName = name;
    if (color !== undefined) rowPatch.personaColor = color;
    if (Object.keys(rowPatch).length > 0) {
      await Promise.all([
        db.update(prospects).set(rowPatch).where(eq(prospects.personaId, id)),
        db.update(leadListItems).set(rowPatch).where(eq(leadListItems.personaId, id)),
        db.update(postEngagements).set(rowPatch).where(eq(postEngagements.personaId, id)),
      ]);
    }

    return { ok: true };
  },
});
