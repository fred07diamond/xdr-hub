import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icpPersonaDocs, icpPersonas, leadListItems, postEngagements, prospects } from "../server/db/schema.js";
import { countWords, rebuildPersonaIcpText } from "../server/helpers/persona-docs.js";
import { requireAdminFromSessionOrToken } from "../server/helpers/require-admin.js";

export default defineAction({
  description:
    "Update an ICP persona's name or color, or REPLACE all of its ICP documents with a single one. To add a document alongside the persona's existing documents, use add-persona-documents instead — passing icpText here discards every document already attached.",
  schema: z.object({
    id: z.string(),
    name: z.string().min(1).max(80).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    icpText: z
      .string()
      .min(1)
      .optional()
      .describe("Destructive: replaces ALL of this persona's documents with one document"),
    apiToken: z.string().nullish().describe("Personal API token — extension callers only"),
  }),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: false, requiresAuth: false },
  run: async ({ id, name, color, icpText, apiToken }, ctx) => {
    await requireAdminFromSessionOrToken(apiToken, ctx);
    const db = getDb();
    const existing = await db
      .select({ name: icpPersonas.name })
      .from(icpPersonas)
      .where(eq(icpPersonas.id, id))
      .limit(1);

    const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (name !== undefined) patch.name = name;
    if (color !== undefined) patch.color = color;
    await db.update(icpPersonas).set(patch).where(eq(icpPersonas.id, id));

    // icpText is DERIVED from icpPersonaDocs (server/helpers/persona-docs.ts),
    // so this can't just write the column -- the next add/delete of a document
    // would rebuild icpText from the docs table and silently throw this text
    // away. Replace the document set instead, which keeps one source of truth
    // and preserves this argument's original "replace the persona's text"
    // meaning for existing callers.
    if (icpText !== undefined) {
      await db.delete(icpPersonaDocs).where(eq(icpPersonaDocs.personaId, id));
      await db.insert(icpPersonaDocs).values({
        id: nanoid(),
        personaId: id,
        name: `${name ?? existing[0]?.name ?? "ICP"} document`,
        text: icpText,
        wordCount: countWords(icpText),
        sortOrder: 0,
        createdAt: new Date().toISOString(),
      });
      await rebuildPersonaIcpText(db, id);
    }

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
