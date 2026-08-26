import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { addPersonaDoc, getSharedDb, sharedPersonaDocs, sharedPersonas } from "@xdr-hub/shared/server";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { personas } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Update a core persona's name, color, description, document text (replacing its entire document set with one new document), its structured CommonRoom Prospector title/org include-exclude lists, or its linked li-agent persona (for LinkedIn-leg pool pulls in prospect pull plans).",
  schema: z.object({
    id: z.string().min(1),
    name: z.string().nullish(),
    color: z.string().nullish(),
    description: z.string().nullish(),
    text: z.string().nullish().describe("New document text — REPLACES this persona's entire document set with a single new document"),
    titleIncludeKeywords: z
      .array(z.string())
      .nullish()
      .describe("Replaces this persona's structured title-include list entirely — used directly by pull-plan sourcing rules instead of the LLM-derived guess"),
    titleExcludeKeywords: z
      .array(z.string())
      .nullish()
      .describe("Replaces this persona's structured title-exclude list entirely — applied as a post-filter (CommonRoom has no server-side exclude operator)"),
    orgIncludeList: z
      .array(z.string())
      .nullish()
      .describe("Replaces this persona's structured current-organization-include list entirely"),
    orgExcludeList: z
      .array(z.string())
      .nullish()
      .describe("Replaces this persona's structured current-organization-exclude list entirely — applied as a post-filter"),
    liAgentPersonaId: z
      .string()
      .nullish()
      .describe("Id of the matching persona in li-agent's icpPersonas table, or null to unlink"),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async (
    { id, name, color, description, text, titleIncludeKeywords, titleExcludeKeywords, orgIncludeList, orgExcludeList, liAgentPersonaId },
    ctx,
  ) => {
    await requireRole(ctx?.userEmail, ["admin"]);
    const db = getDb();
    const sharedDb = getSharedDb();

    const existing = await sharedDb.select({ id: sharedPersonas.id }).from(sharedPersonas).where(eq(sharedPersonas.id, id)).limit(1);
    if (!existing[0]) {
      throw Object.assign(new Error(`Persona ${id} not found.`), { statusCode: 404 });
    }

    // Structured Prospector targeting fields: `undefined` means "not part of
    // this request" (leave alone); `null` or `[]` both mean "clear the
    // list" — an empty array still needs writing (JSON.stringify([]) is
    // truthy as a string), so these check `!== undefined` rather than
    // truthiness like name/color above.
    const hasTitleInclude = titleIncludeKeywords !== undefined;
    const hasTitleExclude = titleExcludeKeywords !== undefined;
    const hasOrgInclude = orgIncludeList !== undefined;
    const hasOrgExclude = orgExcludeList !== undefined;

    if (
      name ||
      color ||
      (description !== undefined && description !== null) ||
      hasTitleInclude ||
      hasTitleExclude ||
      hasOrgInclude ||
      hasOrgExclude
    ) {
      await sharedDb
        .update(sharedPersonas)
        .set({
          ...(name ? { name } : {}),
          ...(color ? { color } : {}),
          ...(description !== undefined && description !== null ? { description } : {}),
          ...(hasTitleInclude ? { titleIncludeKeywords: titleIncludeKeywords ? JSON.stringify(titleIncludeKeywords) : null } : {}),
          ...(hasTitleExclude ? { titleExcludeKeywords: titleExcludeKeywords ? JSON.stringify(titleExcludeKeywords) : null } : {}),
          ...(hasOrgInclude ? { orgIncludeList: orgIncludeList ? JSON.stringify(orgIncludeList) : null } : {}),
          ...(hasOrgExclude ? { orgExcludeList: orgExcludeList ? JSON.stringify(orgExcludeList) : null } : {}),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(sharedPersonas.id, id));
    }

    // `text` REPLACES this persona's entire document set with one new
    // document — mirrors the old destructive-replace semantics of the
    // `criteria` column, just against the doc table now.
    if (text) {
      await sharedDb.delete(sharedPersonaDocs).where(eq(sharedPersonaDocs.personaId, id));
      await addPersonaDoc(sharedDb, { personaId: id, fileName: "Original upload", content: text });
    }

    // liAgentPersonaId is a Phase 5 bridge field that still lives on the OLD
    // local `personas` table — out of scope for this migration, untouched.
    if (liAgentPersonaId !== undefined) {
      await db.update(personas).set({ liAgentPersonaId: liAgentPersonaId ?? null }).where(eq(personas.id, id));
    }

    return { id };
  },
});
