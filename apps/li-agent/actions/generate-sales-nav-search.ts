import { defineAction } from "@agent-native/core";
import { completeText, runWithRequestContext } from "@agent-native/core/server";
import { isNotNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icpPersonas } from "../server/db/schema.js";
import { resolveOwnerStrict } from "../server/helpers/resolve-owner.js";
import { checkRateLimit } from "../server/helpers/rate-limit.js";
import { getOwnerCtx } from "../server/helpers/get-owner-ctx.js";

// Turns a plain-English prompt ("design persona folks") into a real Sales
// Navigator search URL the rep can click -- never fills Sales Nav's own
// filter UI or pages through results automatically. That's a deliberate
// scope boundary: this extension's Sales Nav handling never auto-clicks
// pagination (see panel.js), to avoid anything that looks like automated
// LinkedIn navigation. This action only builds a link; a human still
// clicks it and pages through themselves, same as any other search.
//
// v1 mechanism: a Boolean-composed keyword string (Sales Nav's documented
// AND/OR/NOT/quotes/parens syntax) in the search URL's `keywords` param.
// Chip-based filters (Function/Seniority/Industry) use LinkedIn's internal
// opaque IDs in the URL, not human-readable text -- encoding those
// correctly needs live reverse-engineering that hasn't been done, so v1
// deliberately doesn't attempt them.
export default defineAction({
  description: "Generate a Sales Navigator search URL from a plain-English prompt, grounded in the workspace's saved ICP personas when the prompt matches one.",
  schema: z.object({
    prompt: z.string().min(1),
    apiToken: z.string().nullish().describe("Personal API token from Settings"),
  }),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: false, requiresAuth: false },
  http: { method: "POST" },
  run: async ({ prompt, apiToken }, ctx) => {
    const ownerEmail = await resolveOwnerStrict(apiToken, ctx);
    if (!ownerEmail) return { error: "Sign in with a personal API token to use this." };

    if (!(await checkRateLimit(ownerEmail, "generate-sales-nav-search", 100))) {
      return { error: "Rate limit reached -- try again shortly." };
    }

    const db = getDb();
    const personas = await db
      .select({ id: icpPersonas.id, name: icpPersonas.name, icpText: icpPersonas.icpText, summary: icpPersonas.summary })
      .from(icpPersonas)
      .where(isNotNull(icpPersonas.icpText));

    const personaList = personas.length
      ? personas.map((p, i) => `${i + 1}. ${p.name}: ${(p.summary ?? p.icpText ?? "").slice(0, 400)}`).join("\n\n")
      : "(no saved personas)";

    const systemPrompt =
      "You turn a sales rep's plain-English request into a LinkedIn Sales Navigator Boolean keyword search. " +
      "If the request clearly matches one of the numbered personas below, base your search on that persona's REAL criteria " +
      "(titles, seniority language, function) rather than guessing from the request's wording alone. " +
      "Sales Navigator's Boolean search rules: operators AND/OR/NOT must be uppercase, use quotes for exact phrases, " +
      "use parentheses to group OR-alternatives, e.g. (Director OR VP OR \"Head of\") AND (Design OR \"User Experience\" OR UX OR UI). " +
      "Reply with ONLY a JSON object on one line, no markdown, no code fences, in this exact shape: " +
      '{"booleanQuery": "...", "summary": "one plain-English sentence describing who this search targets", "matchedPersonaName": "exact persona name or null"}';

    try {
      const ownerCtxForCall = await getOwnerCtx();
      const call = () =>
        completeText({
          systemPrompt,
          input: `Saved personas:\n${personaList}\n\nRequest: ${prompt}`,
          maxOutputTokens: 300,
        });
      const result = ownerCtxForCall ? await runWithRequestContext(ownerCtxForCall, call) : await call();

      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { error: "Could not generate a search from that -- try rephrasing." };
      const parsed = JSON.parse(jsonMatch[0]) as { booleanQuery?: string; summary?: string; matchedPersonaName?: string | null };
      if (!parsed.booleanQuery?.trim()) return { error: "Could not generate a search from that -- try rephrasing." };

      const searchUrl = `https://www.linkedin.com/sales/search/people?keywords=${encodeURIComponent(parsed.booleanQuery.trim())}`;
      return {
        searchUrl,
        summary: parsed.summary ?? null,
        matchedPersonaName: parsed.matchedPersonaName ?? null,
      };
    } catch {
      return { error: "Something went wrong generating that search -- try again." };
    }
  },
});
