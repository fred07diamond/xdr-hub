import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icpPersonas } from "../server/db/schema.js";
import { adoptLegacyIcpTextAsDoc, rebuildPersonaIcpText } from "../server/helpers/persona-docs.js";
import { buildPersonaBriefing, hashIcpText } from "../server/helpers/persona-briefing.js";
import { requireAdminFromSessionOrToken } from "../server/helpers/require-admin.js";

// On-demand only, same policy as Apollo enrichment: the user presses a button.
// Never generate a briefing automatically on a page load or at document-upload
// time -- a workspace with a dozen personas would fire a dozen LLM calls that
// nobody asked for.
export default defineAction({
  description:
    "Generate (or regenerate) the briefing for one ICP persona: which titles to target, how to speak to them, why they buy, and what they care about organizationally. Derived from that persona's ICP documents. Call this when the user asks for a persona breakdown, summary, or briefing, or asks to refresh one after changing documents.",
  schema: z.object({
    personaId: z.string(),
    apiToken: z.string().nullish().describe("Personal API token — extension callers only"),
  }),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: false, requiresAuth: false },
  run: async ({ personaId, apiToken }, ctx) => {
    await requireAdminFromSessionOrToken(apiToken, ctx);
    const db = getDb();

    const rows = await db
      .select({ id: icpPersonas.id, name: icpPersonas.name, icpText: icpPersonas.icpText })
      .from(icpPersonas)
      .where(eq(icpPersonas.id, personaId))
      .limit(1);
    const persona = rows[0];
    if (!persona) return { ok: false as const, error: "Persona not found." };

    // A persona from before multi-document support has icpText but no doc rows.
    // Adopt it before reading, so its briefing is generated from the same text
    // the document list will show rather than from a column about to be
    // rebuilt out from under it.
    if (await adoptLegacyIcpTextAsDoc(db, persona)) {
      await rebuildPersonaIcpText(db, personaId);
    }

    const current = await db
      .select({ icpText: icpPersonas.icpText })
      .from(icpPersonas)
      .where(eq(icpPersonas.id, personaId))
      .limit(1);
    const icpText = current[0]?.icpText ?? null;

    if (!icpText?.trim()) {
      return {
        ok: false as const,
        error: "This persona has no ICP documents yet. Upload one to generate a briefing.",
      };
    }

    let briefing;
    try {
      briefing = await buildPersonaBriefing({ personaName: persona.name, icpText });
    } catch (err) {
      // Leave any previous briefing in place -- a failed regeneration should
      // not cost the user the briefing they already had.
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : "Could not generate the briefing.",
      };
    }
    if (!briefing) {
      return {
        ok: false as const,
        error: "This persona has no ICP documents yet. Upload one to generate a briefing.",
      };
    }

    const generatedAt = new Date().toISOString();
    await db
      .update(icpPersonas)
      .set({
        briefing: JSON.stringify(briefing),
        briefingGeneratedAt: generatedAt,
        briefingSourceHash: hashIcpText(icpText),
        updatedAt: generatedAt,
      })
      .where(eq(icpPersonas.id, personaId));

    return { ok: true as const, personaId, briefing, generatedAt };
  },
});
