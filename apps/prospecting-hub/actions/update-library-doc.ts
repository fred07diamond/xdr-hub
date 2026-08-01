import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { libraryDocs } from "../server/db/schema.js";
import { deriveLibraryTags, LIBRARY_CATEGORIES } from "../server/helpers/library-tagging.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "Update a Sales Library document. Owner or admin only. If text changes without an explicit category/tags override in the same call, category/tags are re-derived by AI from the new text.",
  schema: z.object({
    id: z.string().min(1),
    name: z.string().min(1).nullish(),
    category: z.enum(LIBRARY_CATEGORIES).nullish(),
    tags: z.array(z.string()).nullish(),
    text: z.string().min(1).nullish(),
    linkedPersonaId: z.string().nullish(),
    linkedIcpId: z.string().nullish(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ id, name, category, tags, text, linkedPersonaId, linkedIcpId }, ctx) => {
    const role = await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    const existing = await db.select().from(libraryDocs).where(eq(libraryDocs.id, id)).limit(1);
    if (!existing[0]) {
      return { ok: false, error: `Library doc ${id} not found.` };
    }
    if (existing[0].ownerEmail !== ctx!.userEmail! && role !== "admin") {
      return { ok: false, error: "Only the document's owner or a manager can update this." };
    }

    if (
      name == null &&
      category == null &&
      tags == null &&
      text == null &&
      linkedPersonaId == null &&
      linkedIcpId == null
    ) {
      throw Object.assign(new Error("Provide at least one field to update."), { statusCode: 400 });
    }

    let finalCategory = category ?? undefined;
    let finalTags = tags ?? undefined;

    // Re-derive category/tags from the new text unless the caller explicitly
    // supplied BOTH in the same call (an intentional override we don't
    // second-guess).
    if (text != null && !(category != null && tags != null)) {
      const derived = await deriveLibraryTags(text);
      if (finalCategory === undefined) finalCategory = derived.category;
      if (finalTags === undefined) finalTags = derived.tags;
    }

    await db
      .update(libraryDocs)
      .set({
        ...(name != null ? { name } : {}),
        ...(finalCategory !== undefined ? { category: finalCategory } : {}),
        ...(finalTags !== undefined ? { tags: JSON.stringify(finalTags) } : {}),
        ...(text != null ? { content: text } : {}),
        ...(linkedPersonaId !== undefined ? { linkedPersonaId } : {}),
        ...(linkedIcpId !== undefined ? { linkedIcpId } : {}),
      })
      .where(eq(libraryDocs.id, id));

    return { ok: true, id };
  },
});
