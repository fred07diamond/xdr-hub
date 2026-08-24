import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { getSharedDb, sharedLibraryDocs, sharedPersonas } from "@xdr-hub/shared/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { deriveLibraryTags } from "../server/helpers/library-tagging.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "Add a document to the Sales Library (call scripts, ICP notes, positioning docs, etc.) — any XDR/AE can contribute. Category and tags are always AI-derived from the text on create; edit them afterward via update-library-doc.",
  schema: z.object({
    name: z.string().min(1),
    text: z.string().min(1),
    linkedPersonaId: z.string().nullish(),
    linkedIcpId: z.string().nullish(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ name, text, linkedPersonaId, linkedIcpId }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const sharedDb = getSharedDb();

    if (linkedPersonaId) {
      const existing = await sharedDb
        .select({ id: sharedPersonas.id })
        .from(sharedPersonas)
        .where(eq(sharedPersonas.id, linkedPersonaId))
        .limit(1);
      if (!existing[0]) {
        throw Object.assign(new Error(`Persona ${linkedPersonaId} not found.`), { statusCode: 404 });
      }
    }

    // Note: no `icps` table exists yet (it lands in a later task in this
    // batch) — skip the existence check for linkedIcpId until it does.

    const { category, tags } = await deriveLibraryTags(text);

    const id = nanoid();
    await sharedDb.insert(sharedLibraryDocs).values({
      id,
      name,
      category,
      tags: JSON.stringify(tags),
      content: text,
      linkedPersonaId: linkedPersonaId ?? null,
      linkedIcpId: linkedIcpId ?? null,
      ownerEmail: ctx!.userEmail!,
      createdAt: new Date().toISOString(),
    });

    return { id, category, tags };
  },
});
