import { defineAction } from "@agent-native/core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { addPersonaDoc, getSharedDb, sharedPersonas } from "@xdr-hub/shared/server";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Create a core persona from an uploaded document's text content, optionally with structured CommonRoom Prospector title/org include-exclude lists.",
  schema: z.object({
    name: z.string().min(1),
    color: z.string().min(1),
    description: z.string().nullish(),
    text: z.string().min(1).describe("The persona doc's full text content"),
    titleIncludeKeywords: z.array(z.string()).nullish(),
    titleExcludeKeywords: z.array(z.string()).nullish(),
    orgIncludeList: z.array(z.string()).nullish(),
    orgExcludeList: z.array(z.string()).nullish(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async (
    { name, color, description, text, titleIncludeKeywords, titleExcludeKeywords, orgIncludeList, orgExcludeList },
    ctx,
  ) => {
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
      titleIncludeKeywords: titleIncludeKeywords && titleIncludeKeywords.length > 0 ? JSON.stringify(titleIncludeKeywords) : null,
      titleExcludeKeywords: titleExcludeKeywords && titleExcludeKeywords.length > 0 ? JSON.stringify(titleExcludeKeywords) : null,
      orgIncludeList: orgIncludeList && orgIncludeList.length > 0 ? JSON.stringify(orgIncludeList) : null,
      orgExcludeList: orgExcludeList && orgExcludeList.length > 0 ? JSON.stringify(orgExcludeList) : null,
    });
    // Criteria is always derived from sharedPersonaDocs now (no single
    // criteria column on sharedPersonas) -- the first upload becomes this
    // persona's first document.
    await addPersonaDoc(sharedDb, { personaId: id, fileName: "Original upload", content: text });
    return { id };
  },
});
