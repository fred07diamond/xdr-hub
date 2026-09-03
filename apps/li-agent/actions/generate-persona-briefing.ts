import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getPersonaCriteriaText, getSharedDb, sharedPersonas } from "@xdr-hub/shared/server";
import { buildPersonaBriefing, hashIcpText, type PersonaBriefing } from "../server/helpers/persona-briefing.js";
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
    const sharedDb = getSharedDb();

    const rows = await sharedDb
      .select({
        id: sharedPersonas.id,
        name: sharedPersonas.name,
        // Needed for the gap fill below, not just for the write.
        briefing: sharedPersonas.briefing,
        briefingSourceHash: sharedPersonas.briefingSourceHash,
      })
      .from(sharedPersonas)
      .where(eq(sharedPersonas.id, personaId))
      .limit(1);
    const persona = rows[0];
    if (!persona) return { ok: false as const, error: "Persona not found." };

    const { text: icpText } = await getPersonaCriteriaText(sharedDb, personaId);

    if (!icpText?.trim()) {
      return {
        ok: false as const,
        error: "This persona has no ICP documents yet. Upload one to generate a briefing.",
      };
    }

    // Gap fill: if a briefing is already stored AND it came from this exact
    // ICP text, hand it to the builder so phases it already covers are
    // skipped and phases that fail keep what was there. Generation is split
    // across several model calls and any one of them can time out, so
    // without this a regenerate could hand back one section while losing
    // another -- trading gaps instead of closing them. A changed ICP
    // (different hash) deliberately regenerates everything.
    const sourceHash = hashIcpText(icpText);
    let existing: PersonaBriefing | null = null;
    if (persona.briefing && persona.briefingSourceHash === sourceHash) {
      try {
        existing = JSON.parse(persona.briefing) as PersonaBriefing;
      } catch {
        existing = null; // unreadable stored briefing: regenerate from scratch
      }
    }

    let briefing;
    try {
      briefing = await buildPersonaBriefing({ personaName: persona.name, icpText, existing });
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
    await sharedDb
      .update(sharedPersonas)
      .set({
        briefing: JSON.stringify(briefing),
        briefingGeneratedAt: generatedAt,
        briefingSourceHash: hashIcpText(icpText),
        updatedAt: generatedAt,
      })
      .where(eq(sharedPersonas.id, personaId));

    return { ok: true as const, personaId, briefing, generatedAt };
  },
});
