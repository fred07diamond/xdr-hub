import { defineAction } from "@agent-native/core";
import { completeText, runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadLists, leadListItems } from "../server/db/schema.js";
import { resolveOwnerStrict } from "../server/helpers/resolve-owner.js";
import { checkRateLimit } from "../server/helpers/rate-limit.js";
import { getOwnerCtx } from "../server/helpers/get-owner-ctx.js";

// One short LLM-generated blurb about a lead list, shown in the extension's
// "Export to Apollo" picker before the rep generates a CSV. Same
// completeText/getOwnerCtx convention as select-persona.ts's batch
// classification call -- one call for the whole list, not one per lead.
export default defineAction({
  description: "Generate a one-line AI summary of a lead list (persona mix, top companies), for the extension's Apollo export picker.",
  schema: z.object({
    listId: z.string(),
    apiToken: z.string().nullish().describe("Personal API token from Settings"),
  }),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: true, requiresAuth: false },
  http: { method: "GET" },
  run: async ({ listId, apiToken }, ctx) => {
    const ownerEmail = await resolveOwnerStrict(apiToken, ctx);
    if (!ownerEmail) return { summary: null };

    if (!(await checkRateLimit(ownerEmail, "summarize-lead-list-for-extension", 100))) {
      return { summary: null, error: "Rate limit reached -- try again shortly." };
    }

    const db = getDb();
    const [list] = await db
      .select({ id: leadLists.id, name: leadLists.name })
      .from(leadLists)
      .where(and(eq(leadLists.id, listId), eq(leadLists.ownerEmail, ownerEmail)));
    if (!list) return { summary: null };

    const items = await db
      .select({ headline: leadListItems.headline, company: leadListItems.company, personaName: leadListItems.personaName })
      .from(leadListItems)
      .where(eq(leadListItems.listId, listId));
    if (items.length === 0) return { summary: null };

    const personaCounts = new Map<string, number>();
    const companyCounts = new Map<string, number>();
    for (const item of items) {
      if (item.personaName) personaCounts.set(item.personaName, (personaCounts.get(item.personaName) ?? 0) + 1);
      if (item.company) companyCounts.set(item.company, (companyCounts.get(item.company) ?? 0) + 1);
    }
    const topPersonas = [...personaCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, n]) => `${name} (${n})`).join(", ");
    const topCompanies = [...companyCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name]) => name).join(", ");
    const sampleTitles = items.slice(0, 15).map((i) => i.headline).filter(Boolean).join("; ");

    try {
      const ownerCtxForSummary = await getOwnerCtx();
      const call = () =>
        completeText({
          systemPrompt:
            "You write a single, plain, one-sentence summary of a sales lead list for a rep about to export it. " +
            "Mention the size, the dominant persona(s) if any, and notable company patterns. No preamble, no markdown, just the sentence.",
          input: `List "${list.name}" -- ${items.length} leads.\nPersona breakdown: ${topPersonas || "none assigned"}.\nTop companies: ${topCompanies || "varied"}.\nSample titles: ${sampleTitles || "none"}.`,
          maxOutputTokens: 80,
        });
      const result = ownerCtxForSummary ? await runWithRequestContext(ownerCtxForSummary, call) : await call();
      return { summary: result.text.trim() };
    } catch {
      // Best-effort -- a summary failure must never block the export itself.
      return { summary: null };
    }
  },
});
