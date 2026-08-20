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
// v2 mechanism: real Sales Nav filter chips (Function, Seniority level,
// Geography, Company headcount, Company type), not just a keyword string.
// These ID tables were reverse-engineered from real Sales Nav search URLs
// the user captured from their own account (not guessed) -- Function and
// Seniority use small fixed integer IDs, Geography/Headcount/Type use
// fixed letter/region codes. Company and Past Company filters use LinkedIn
// entity URNs (e.g. urn:li:organization:1033) that require a name-to-ID
// typeahead lookup we don't have -- those stay out of scope. Title nuance
// that doesn't map to a Function/Seniority bucket still goes through the
// documented Boolean keyword syntax, combined with the structured filters.
const FUNCTION_IDS: Record<string, number> = {
  "Accounting": 1,
  "Administrative": 2,
  "Arts and Design": 3,
  "Business Development": 4,
  "Community and Social Services": 5,
  "Consulting": 6,
  "Education": 7,
  "Engineering": 8,
  "Entrepreneurship": 9,
  "Finance": 10,
  "Healthcare Services": 11,
  "Human Resources": 12,
  "Information Technology": 13,
  "Legal": 14,
  "Marketing": 15,
  "Media and Communication": 16,
  "Military and Protective Services": 17,
  "Operations": 18,
  "Product Management": 19,
  "Program and Project Management": 20,
  "Purchasing": 21,
  "Quality Assurance": 22,
  "Real Estate": 23,
  "Research": 24,
  "Sales": 25,
  "Customer Success and Support": 26,
};

const SENIORITY_IDS: Record<string, number> = {
  "In Training": 100,
  "Entry Level": 110,
  "Senior": 120,
  "Strategic": 130,
  "Entry Level Manager": 200,
  "Experienced Manager": 210,
  "Director": 220,
  "Vice President": 300,
  "CXO": 310,
  "Owner / Partner": 320,
};

const REGION_IDS: Record<string, number> = {
  "North America": 102221843,
  "South America": 104514572,
  "Europe": 100506914,
  "Africa": 103537801,
  "Asia": 102393603,
  "Oceania": 91000010,
  "EMEA": 91000007,
  "APAC": 91000003,
  "APJ": 91000004,
  "DACH": 91000006,
  "Benelux": 91000005,
  "Nordics": 91000009,
  "MENA": 91000008,
};

const COMPANY_HEADCOUNT_IDS: Record<string, string> = {
  "Self-employed": "A",
  "1-10": "B",
  "11-50": "C",
  "51-200": "D",
  "201-500": "E",
  "501-1000": "F",
  "1001-5000": "G",
  "5001-10,000": "H",
  "10,000+": "I",
};

const COMPANY_TYPE_IDS: Record<string, string> = {
  "Public Company": "C",
  "Privately Held": "P",
  "Educational Institution": "D",
  "Non Profit": "N",
  "Partnership": "S",
  "Self Employed": "E",
  "Self Owned": "O",
  "Government Agency": "G",
};

// Confirmed from a real captured URL: excludes/includes leads already
// tracked in the connected CRM. id is a fixed literal, not an int/letter.
const LEADS_IN_CRM_ID = "LCRM";

// LinkedIn's query mini-language uses literal "(" / ")" as structural
// nesting delimiters throughout the whole `query=` value, decoded one level
// at a time. encodeURIComponent leaves parens untouched (they're in its
// unreserved set), so a value containing a literal paren -- e.g. Boolean
// grouping in a keyword string -- collides with that structural syntax and
// corrupts the parse (confirmed: this produced a real Sales Nav server
// error). Fix: push parens down one encoding level, same as colons/spaces
// in "text" values are pre-encoded before the outer encode pass doubles
// them -- so a literal "(" survives as inert text ("%28") through
// structural parsing instead of being read as nesting.
function encodeLeaf(value: string | number): string {
  return encodeURIComponent(String(value)).replace(/\(/g, "%28").replace(/\)/g, "%29");
}

function buildFilterEntry(
  type: string,
  entries: Array<{ id: string | number; text: string; selectionType?: "INCLUDED" | "EXCLUDED" }>,
): string {
  const values = entries
    .map((e) => `(id:${encodeLeaf(e.id)},text:${encodeLeaf(e.text)},selectionType:${e.selectionType ?? "INCLUDED"})`)
    .join(",");
  return `(type:${type},values:List(${values}))`;
}

// Case-insensitive match against a known enum, dropping anything the model
// invents that isn't one of the real, confirmed values.
function resolveEnumValues<T extends string | number>(
  requested: string[] | undefined,
  table: Record<string, T>,
): Array<{ id: T; text: string }> {
  if (!requested?.length) return [];
  const lower = new Map(Object.keys(table).map((k) => [k.toLowerCase(), k]));
  const out: Array<{ id: T; text: string }> = [];
  for (const req of requested) {
    const key = lower.get(req.trim().toLowerCase());
    if (key) out.push({ id: table[key], text: key });
  }
  return out;
}

export default defineAction({
  description: "Generate a Sales Navigator search URL with real filter chips (Function, Seniority, Geography, Company size/type) from a plain-English prompt, grounded in the workspace's saved ICP personas when the prompt matches one. Pass companyName to scope the search to one account (e.g. from My Accounts) -- folded into the keywords text since there's no real company filter available.",
  schema: z.object({
    prompt: z.string().min(1),
    companyName: z
      .string()
      .nullish()
      .describe(
        "Optional company to scope the search to (e.g. from the My Accounts page). There's no real Sales Nav company filter " +
          "available (see comment below), so this is folded into the keywords text deterministically, never left to the model.",
      ),
    apiToken: z.string().nullish().describe("Personal API token from Settings"),
  }),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: false, requiresAuth: false },
  http: { method: "POST" },
  run: async ({ prompt, companyName, apiToken }, ctx) => {
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

    // icpText, not summary -- summary is only the persona document's FIRST
    // PARAGRAPH (see extractSummary() in create-icp-persona.ts, capped at
    // 220 chars), so it never includes a "Common titles" section further
    // down the doc. Using summary here was silently hiding every persona's
    // real title list from the model, which is why generated searches
    // collapsed to a generic Function bucket instead of the actual titles.
    const personaList = personas.length
      ? personas.map((p, i) => `${i + 1}. ${p.name}: ${(p.icpText ?? p.summary ?? "").slice(0, 1200)}`).join("\n\n")
      : "(no saved personas)";

    const systemPrompt =
      "You turn a sales rep's plain-English request into real LinkedIn Sales Navigator search filters. " +
      "If the request clearly matches one of the numbered personas below, base your filters on that persona's REAL criteria " +
      "(titles, seniority language, function) rather than guessing from the request's wording alone. " +
      "Reply with ONLY a JSON object on one line, no markdown, no code fences, in this exact shape: " +
      '{"function": ["..."], "seniorityLevel": ["..."], "region": ["..."], "companyHeadcount": ["..."], "companyType": ["..."], ' +
      '"excludeCrmLeads": false, "titleKeywords": "...", "unsupportedNotes": "...", ' +
      '"summary": "one plain-English sentence describing who this search targets", "matchedPersonaName": "exact persona name or null"}\n\n' +
      "Rules:\n" +
      `- "function" values MUST come only from this exact list (use the exact text): ${Object.keys(FUNCTION_IDS).join(", ")}\n` +
      `- "seniorityLevel" values MUST come only from this exact list: ${Object.keys(SENIORITY_IDS).join(", ")}\n` +
      `- "region" is CONTINENT/MACRO-REGION level ONLY, and values MUST come only from this exact list: ${Object.keys(REGION_IDS).join(", ")}. ` +
      "If the request names a specific country or city (e.g. \"United States\", \"New York\") that is NOT one of those exact region names, " +
      "do NOT approximate or substitute the closest region -- leave \"region\" empty and instead explain the gap in \"unsupportedNotes\" " +
      "(e.g. \"Country/city-level geography isn't supported yet, only continent-level regions -- couldn't filter to United States specifically\").\n" +
      `- "companyHeadcount" values MUST come only from this exact list: ${Object.keys(COMPANY_HEADCOUNT_IDS).join(", ")}\n` +
      `- "companyType" values MUST come only from this exact list: ${Object.keys(COMPANY_TYPE_IDS).join(", ")}\n` +
      "- \"excludeCrmLeads\" is true only if the request explicitly wants to exclude people already tracked in the CRM (e.g. \"not in the CRM\", \"exclude existing CRM contacts\"). Otherwise false.\n" +
      "- Only include a field's array with values if the request actually implies that criterion -- leave it an empty array otherwise. Don't force a seniority or headcount guess that wasn't implied.\n" +
      "- If the matched persona's text lists specific job titles (e.g. a \"Common titles\" section, or any explicit list of title phrases), " +
      "ALWAYS put every one of those exact titles into \"titleKeywords\" as a quoted Boolean OR, e.g. " +
      "(\"Sr Design Manager\" OR \"Director of Design\" OR \"Director of Design Systems\" OR \"Director of Design Technology\" OR \"Head of Design Operations\"). " +
      "Do NOT drop or paraphrase them just because a \"function\" bucket also loosely applies -- function/seniority are broad, low-precision supplements to the real titles, never a replacement for them. " +
      "Only fall back to \"function\"/\"seniorityLevel\" alone, with titleKeywords empty, when the persona (or request) gives no specific title language at all.\n" +
      "- Sales Navigator Boolean rules apply to titleKeywords: AND/OR/NOT uppercase, quotes for exact phrases, parens for grouping.\n" +
      "- \"unsupportedNotes\" is a short plain-English note (or empty string) about any part of the request you could NOT express in these filters (e.g. a specific company, a specific city/country, an industry). Be honest about gaps rather than silently dropping or mis-mapping them. Keep it to one sentence.\n" +
      "- There is NO company-targeting field available at all -- Company/Past Company require an internal LinkedIn ID lookup this tool doesn't have. If the request names specific companies (e.g. \"folks at Acme and Globex\"), do NOT refuse and do NOT reply with plain-text explanation instead of JSON -- list the company names in \"unsupportedNotes\" and still fill in every other field you CAN determine from the rest of the request (function, seniority, region, headcount, companyType, excludeCrmLeads, titleKeywords).\n" +
      "- You must ALWAYS reply with the exact JSON shape above, even when most of the request can't be expressed in these filters. Never reply with plain prose, an apology, or an explanation instead of the JSON object -- put anything unsupported in \"unsupportedNotes\" and still return whatever filters you can. Keep \"summary\" and \"unsupportedNotes\" each to one short sentence so the reply stays compact.";

    try {
      const ownerCtxForCall = await getOwnerCtx();
      const call = () =>
        completeText({
          systemPrompt,
          input: `Saved personas:\n${personaList}\n\nRequest: ${prompt}`,
          maxOutputTokens: 600,
        });
      const result = ownerCtxForCall ? await runWithRequestContext(ownerCtxForCall, call) : await call();

      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { error: "Could not generate a search from that -- try rephrasing." };
      const parsed = JSON.parse(jsonMatch[0]) as {
        function?: string[];
        seniorityLevel?: string[];
        region?: string[];
        companyHeadcount?: string[];
        companyType?: string[];
        excludeCrmLeads?: boolean;
        titleKeywords?: string;
        unsupportedNotes?: string;
        summary?: string;
        matchedPersonaName?: string | null;
      };

      const functionValues = resolveEnumValues(parsed.function, FUNCTION_IDS);
      const seniorityValues = resolveEnumValues(parsed.seniorityLevel, SENIORITY_IDS);
      const regionValues = resolveEnumValues(parsed.region, REGION_IDS);
      const headcountValues = resolveEnumValues(parsed.companyHeadcount, COMPANY_HEADCOUNT_IDS);
      const companyTypeValues = resolveEnumValues(parsed.companyType, COMPANY_TYPE_IDS);
      const titleKeywords = parsed.titleKeywords?.trim() ?? "";

      const filterEntries: string[] = [];
      const appliedFilters: string[] = [];
      if (functionValues.length) {
        filterEntries.push(buildFilterEntry("FUNCTION", functionValues));
        appliedFilters.push(`Function: ${functionValues.map((v) => v.text).join(", ")}`);
      }
      if (seniorityValues.length) {
        filterEntries.push(buildFilterEntry("SENIORITY_LEVEL", seniorityValues));
        appliedFilters.push(`Seniority: ${seniorityValues.map((v) => v.text).join(", ")}`);
      }
      if (regionValues.length) {
        filterEntries.push(buildFilterEntry("REGION", regionValues));
        appliedFilters.push(`Region: ${regionValues.map((v) => v.text).join(", ")}`);
      }
      if (headcountValues.length) {
        filterEntries.push(buildFilterEntry("COMPANY_HEADCOUNT", headcountValues));
        appliedFilters.push(`Company size: ${headcountValues.map((v) => v.text).join(", ")}`);
      }
      if (companyTypeValues.length) {
        filterEntries.push(buildFilterEntry("COMPANY_TYPE", companyTypeValues));
        appliedFilters.push(`Company type: ${companyTypeValues.map((v) => v.text).join(", ")}`);
      }
      if (parsed.excludeCrmLeads) {
        filterEntries.push(
          buildFilterEntry("LEADS_IN_CRM", [{ id: LEADS_IN_CRM_ID, text: "People in CRM", selectionType: "EXCLUDED" }]),
        );
        appliedFilters.push("Excludes: people already in CRM");
      }
      if (titleKeywords) {
        appliedFilters.push(`Title keywords: ${titleKeywords}`);
      }
      const trimmedCompanyName = companyName?.trim() || "";
      if (trimmedCompanyName) {
        appliedFilters.push(`Company: ${trimmedCompanyName}`);
      }

      if (!filterEntries.length && !titleKeywords && !trimmedCompanyName) {
        return { error: "Could not generate a search from that -- try rephrasing with more specific criteria." };
      }

      // Company name folds into the same keywords text as titleKeywords,
      // deterministically here (never left to the model above) -- quoted
      // for an exact-phrase match, same Boolean syntax the model already
      // uses for titleKeywords.
      const combinedKeywords = [titleKeywords, trimmedCompanyName ? `"${trimmedCompanyName}"` : ""].filter(Boolean).join(" ");

      const queryParts: string[] = [];
      if (filterEntries.length) queryParts.push(`filters:List(${filterEntries.join(",")})`);
      if (combinedKeywords) queryParts.push(`keywords:${encodeLeaf(combinedKeywords)}`);
      const rawQuery = `(${queryParts.join(",")})`;
      const searchUrl = `https://www.linkedin.com/sales/search/people?query=${encodeURIComponent(rawQuery)}`;

      return {
        searchUrl,
        summary: parsed.summary ?? null,
        matchedPersonaName: parsed.matchedPersonaName ?? null,
        appliedFilters,
        unsupportedNotes: parsed.unsupportedNotes?.trim() || null,
      };
    } catch {
      return { error: "Something went wrong generating that search -- try again." };
    }
  },
});
