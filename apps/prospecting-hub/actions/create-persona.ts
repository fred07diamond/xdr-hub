import { defineAction } from "@agent-native/core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { addPersonaDoc, getSharedDb, sharedPersonas } from "@xdr-hub/shared/server";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Create a core persona from an uploaded document's text content.",
  schema: z.object({
    name: z.string().min(1),
    color: z.string().min(1),
    description: z.string().nullish(),
    text: z.string().min(1).describe("The persona doc's full text content"),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ name, color, description, text }, ctx) => {
    await requireRole(ctx?.userEmail, ["admin"]);
    const sharedDb = getSharedDb();
    const id = nanoid();
    await sharedDb.insert(sharedPersonas).values({
      id,
      name,
      color,
      description: description ?? null,
      ownerEmail: ctx!.userEmail!,
      createdAt: new Date().toISOString(),
    });
    // Criteria is always derived from sharedPersonaDocs now (no single
    // criteria column on sharedPersonas) -- the first upload becomes this
    // persona's first document.
    await addPersonaDoc(sharedDb, { personaId: id, fileName: "Original upload", content: text });
    return { id };
  },
});
