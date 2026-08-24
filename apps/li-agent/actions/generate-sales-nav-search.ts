import { defineAction } from "@agent-native/core";
import { completeText, runWithRequestContext } from "@agent-native/core/server";
import { eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icpPersonas } from "../server/db/schema.js";
import type { PersonaBriefing } from "../server/helpers/persona-briefing.js";
import { resolveOwnerStrict } from "../server/helpers/resolve-owner.js";
import { checkRateLimit } from "../server/helpers/rate-limit.js";
import { getOwnerCtx } from "../server/helpers/get-owner-ctx.js";
import { accountMatchesTagQuery, fetchOwnedAccounts, rankAccounts } from "../server/helpers/owned-accounts.js";

// When a request references "my accounts" without naming a count, cap how
// many become Current-company chips -- an unbounded book of 271 accounts
// would produce a useless search and a gigantic URL.
const DEFAULT_ACCOUNT_SCOPE_LIMIT = 10;

// Turns a plain-English prompt ("design persona folks") into a real Sales
// Navigator search URL the rep can click -- never fills Sales Nav's own
// filter UI or pages through results automatically. That's a deliberate
// scope boundary: this extension's Sales Nav handling never auto-clicks
// pagination (see panel.js), to avoid anything that looks like automated
// LinkedIn navigation. This action only builds a link; a human still
// clicks it and pages through themselves, same as any other search.
//
// v2 mechanism: real Sales Nav filter chips (Function, Seniority level,
// Geography, Company headcount, Company type, Current job title, Current
// company), not just a keyword string. These ID tables were reverse-
// engineered from real Sales Nav search URLs the user captured from their
// own account (not guessed) -- Function and Seniority use small fixed
// integer IDs, Geography/Headcount/Type use fixed letter/region codes.
//
// CURRENT_TITLE and CURRENT_COMPANY entries omit id entirely. A real
// capture showed LinkedIn's own UI attaches an id when its typeahead
// resolves the value (a numeric id for titles, a urn:li:organization URN
// for companies), but a value with no taxonomy match just omits id -- and
// live-verified with the user: a text-only CURRENT_COMPANY entry renders a
// real "Current company" chip and filters correctly. That matters because
// resolving a company name to its LinkedIn org URN would otherwise need an
// authenticated-session typeahead lookup this backend has no access to.
//
// Using the real CURRENT_COMPANY filter (rather than folding the company
// name into `keywords`) also fixes a precision bug: LinkedIn keyword
// search matches text ANYWHERE on a profile, including past roles, so a
// keyword-scoped company search surfaced people who merely used to work
// there. CURRENT_COMPANY is a true current-employer filter.
//
// Past Company still stays out of scope. Any remaining title-adjacent
// nuance that doesn't reduce to a clean title list still goes through the
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

// id is optional -- confirmed from a real captured CURRENT_TITLE filter: a
// title LinkedIn's own typeahead resolved to its internal taxonomy gets a
// real numeric id (e.g. id:3294,text:"Senior Design Manager"), but a title
// typed free-form with no taxonomy match just omits id entirely
// (text:"Director of Design Systems",selectionType:INCLUDED) and still
// works as a real filter value. We have no taxonomy id table for titles,
// so every title entry this file generates omits id on purpose -- that's
// the same valid shape LinkedIn itself uses for an unmatched title, not a
// guess.
function buildFilterEntry(
  type: string,
  entries: Array<{ id?: string | number; text: string; selectionType?: "INCLUDED" | "EXCLUDED" }>,
): string {
  const values = entries
    .map((e) => {
      const parts: string[] = [];
      if (e.id !== undefined && e.id !== null && e.id !== "") parts.push(`id:${encodeLeaf(e.id)}`);
      parts.push(`text:${encodeLeaf(e.text)}`);
      parts.push(`selectionType:${e.selectionType ?? "INCLUDED"}`);
      return `(${parts.join(",")})`;
    })
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
  description: "Generate a Sales Navigator search URL with real filter chips (Current job title, Function, Seniority, Geography, Company size/type) from a plain-English prompt, grounded in the workspace's saved ICP personas when the prompt matches one -- a persona's exact \"Common titles\" list becomes a real multi-value Current job title filter, not just a keyword search. Pass personaId (e.g. a persona click, rather than free text) to use that persona's exact generated briefing directly -- primary titles plus its fallback tier become INCLUDED Current job title entries, and its 'wrong buyer' avoid-titles become EXCLUDED entries -- skipping the free-text extraction entirely. Pass companyName to scope the search to one account (e.g. from My Accounts) -- becomes a real \"Current company\" filter chip, so it returns only people who work there now, not former employees. Also resolves references to the rep's own HubSpot book of accounts (\"product folks at my top 3 accounts by activity\") into concrete Current-company chips.",
  schema: z.object({
    prompt: z.string().min(1),
    personaId: z
      .string()
      .nullish()
      .describe(
        "Optional id of a saved persona (e.g. from clicking a persona in My Accounts or the ICP tab). When given " +
          "and that persona has a generated briefing, its exact titles/fallbackTitles/avoidTitles are used " +
          "directly as real Current job title filter chips instead of re-deriving titles from `prompt` with a " +
          "fresh model call -- deterministic and reuses the same curated list the rep already reviewed in the " +
          "briefing sheet, including the fallback tier and the 'wrong buyer' exclusions.",
      ),
    companyName: z
      .string()
      .nullish()
      .describe(
        "Optional company to scope the search to (e.g. from the My Accounts page). Becomes a real Sales Nav " +
          "\"Current company\" filter chip -- applied deterministically, never left to the model.",
      ),
    apiToken: z.string().nullish().describe("Personal API token from Settings"),
  }),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: false, requiresAuth: false },
  http: { method: "POST" },
  run: async ({ prompt, personaId, companyName, apiToken }, ctx) => {
    const ownerEmail = await resolveOwnerStrict(apiToken, ctx);
    if (!ownerEmail) return { error: "Sign in with a personal API token to use this." };

    if (!(await checkRateLimit(ownerEmail, "generate-sales-nav-search", 100))) {
      return { error: "Rate limit reached -- try again shortly." };
    }

    const db = getDb();

    // Deterministic fast path: the caller already knows which persona this
    // is (a click, not free text), so skip the fuzzy name-match + second
    // title-extraction LLM call entirely and reuse the persona's own
    // generated briefing -- the same curated primary/fallback/avoid title
    // tiers the rep already reviewed in the briefing sheet, which the old
    // prompt-driven flow below has no concept of (it re-derives one flat,
    // untiered title list from raw ICP text on every click).
    if (personaId) {
      const [persona] = await db
        .select({ id: icpPersonas.id, name: icpPersonas.name, briefing: icpPersonas.briefing })
        .from(icpPersonas)
        .where(eq(icpPersonas.id, personaId))
        .limit(1);

      const briefing: PersonaBriefing | null = persona?.briefing ? JSON.parse(persona.briefing) : null;
      const primaryTitles = briefing?.titles ?? [];
      const fallbackTitles = briefing?.fallbackTitles ?? [];
      // avoidTitlesSearch, NOT avoidTitles -- avoidTitles is deliberately
      // grouped/readable prose for the briefing sheet (e.g. "Creative
      // Director / Brand Designer / Art Director", or a parenthetical
      // example list), which is not a valid literal filter value. Pasting
      // it straight into a Current-job-title exclude entry produced
      // nonsense chips. avoidTitlesSearch is the flat, one-real-title-per-
      // entry form generated specifically for this.
      const avoidTitles = briefing?.avoidTitlesSearch ?? [];

      if (persona && (primaryTitles.length || fallbackTitles.length)) {
        const MAX_TITLES = 25;
        // Sales Nav's own "Current job title" filter lets a rep mark
        // individual entries as Exclude within the same filter -- that's
        // why buildFilterEntry already takes a per-entry selectionType
        // rather than one for the whole call. Primary and fallback tiers
        // both become INCLUDED (no way to conditionally search "fallback
        // only if this account has none of the primary titles" -- Sales
        // Nav has no such conditional -- so both tiers go in to maximize
        // recall), and avoidTitles become EXCLUDED so a "wrong buyer" the
        // briefing flagged as looking close never shows up in results.
        const includeTitles = Array.from(new Set([...primaryTitles, ...fallbackTitles])).slice(0, MAX_TITLES);
        const excludeTitles = Array.from(new Set(avoidTitles)).slice(0, MAX_TITLES);

        const filterEntries: string[] = [
          buildFilterEntry("CURRENT_TITLE", [
            ...includeTitles.map((text) => ({ text, selectionType: "INCLUDED" as const })),
            ...excludeTitles.map((text) => ({ text, selectionType: "EXCLUDED" as const })),
          ]),
        ];
        const appliedFilters: string[] = [`Current job title: ${includeTitles.join(", ")}`];
        if (excludeTitles.length) appliedFilters.push(`Excludes wrong-buyer titles: ${excludeTitles.join(", ")}`);

        const trimmedCompanyName = companyName?.trim() || "";
        if (trimmedCompanyName) {
          filterEntries.push(buildFilterEntry("CURRENT_COMPANY", [{ text: trimmedCompanyName }]));
          appliedFilters.push(`Current company: ${trimmedCompanyName}`);
        }

        const rawQuery = `(filters:List(${filterEntries.join(",")}))`;
        const searchUrl = `https://www.linkedin.com/sales/search/people?query=${encodeURIComponent(rawQuery)}`;

        return {
          searchUrl,
          summary: briefing?.positioning || `${persona.name} at ${trimmedCompanyName || "this account"}`,
          matchedPersonaName: persona.name,
          appliedFilters,
          unsupportedNotes: null,
          scopedAccounts: null,
        };
      }
      // No persona row, or one with no briefing/titles generated yet --
      // fall through to the legacy prompt-driven flow below, which still
      // works off the persona's name as free text.
    }

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
      '"titles": ["..."], "companies": ["..."], "accountScope": {"useMyAccounts": false, "rankBy": null, "limit": null, "tagQuery": null}, ' +
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
      "ALWAYS put every one of those exact titles as separate entries in the \"titles\" array -- one exact phrase per entry, e.g. " +
      "[\"Sr Design Manager\", \"Director of Design\", \"Director of Design Systems\", \"Director of Design Technology\", \"Head of Design Operations\"]. " +
      "This becomes a real LinkedIn \"Current job title\" filter where matching ANY one of them counts (they're OR'd together automatically) -- " +
      "do NOT also combine them into one Boolean string, each title is its own array entry. " +
      "Do NOT drop or paraphrase any of them just because a \"function\" bucket also loosely applies -- function/seniority are broad, low-precision supplements to the real titles, never a replacement for them. " +
      "Only fall back to \"function\"/\"seniorityLevel\" alone, with \"titles\" empty, when the persona (or request) gives no specific title language at all.\n" +
      "- \"titleKeywords\" is a separate, optional field ONLY for title-adjacent language that doesn't reduce to a clean list of titles (e.g. a domain term like \"AI\", or \"recently promoted\"). Leave it empty whenever \"titles\" already covers the request -- don't duplicate the same titles into both fields. Sales Navigator Boolean rules apply if used: AND/OR/NOT uppercase, quotes for exact phrases, parens for grouping.\n" +
      "- \"unsupportedNotes\" is a short plain-English note (or empty string) about any part of the request you could NOT express in these filters (e.g. a specific company, a specific city/country, an industry). Be honest about gaps rather than silently dropping or mis-mapping them. Keep it to one sentence.\n" +
      "- \"companies\" is for CURRENT employer targeting: if the request names specific companies (e.g. \"folks at Acme and Globex\"), put each exact company name as its own array entry. This becomes a real \"Current company\" filter (matching ANY of them), so it only returns people who work there NOW, not former employees. Leave it an empty array if no company was named. Past/former-employer targeting is still NOT supported -- if the request explicitly asks for people who USED to work somewhere, note that in \"unsupportedNotes\" instead.\n" +
      "- \"accountScope\" handles requests that reference the rep's OWN book of accounts in HubSpot rather than naming companies outright. Set \"useMyAccounts\": true when the request says things like \"my accounts\", \"accounts I own\", \"my book\", \"my top accounts\", \"my Tier 1 accounts\". Then:\n" +
      "  - \"rankBy\": \"activity\" for \"most active\"/\"most recently active\"/\"top by activity\"; \"employees\" for \"biggest\"/\"largest\"; otherwise null.\n" +
      "  - \"limit\": the number requested (\"top 3 accounts\" -> 3). Null if no count was given.\n" +
      "  - \"tagQuery\": a short phrase to match against the account's HubSpot attributes when the request narrows by one (\"Tier 1\", \"churned\", \"prospect\"). Null otherwise.\n" +
      "  Leave \"useMyAccounts\": false (and the other three null) whenever the request does NOT reference the rep's own accounts. When useMyAccounts is true, leave \"companies\" empty -- the real company list is resolved from HubSpot afterward, not by you.\n" +
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
        titles?: string[];
        companies?: string[];
        accountScope?: {
          useMyAccounts?: boolean;
          rankBy?: "activity" | "employees" | null;
          limit?: number | null;
          tagQuery?: string | null;
        };
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
      // Cap like every other array field's real-world size -- a hard stop
      // against a runaway/hallucinated list, not an expected normal case.
      const MAX_TITLES = 25;
      const MAX_COMPANIES = 25;
      const titles = Array.from(new Set((parsed.titles ?? []).map((t) => t.trim()).filter(Boolean))).slice(0, MAX_TITLES);

      const filterEntries: string[] = [];
      const appliedFilters: string[] = [];
      if (functionValues.length) {
        filterEntries.push(buildFilterEntry("FUNCTION", functionValues));
        appliedFilters.push(`Function: ${functionValues.map((v) => v.text).join(", ")}`);
      }
      if (titles.length) {
        // No id on any entry -- see buildFilterEntry's comment. Confirmed
        // real, working shape for an unmatched/free-typed title.
        filterEntries.push(buildFilterEntry("CURRENT_TITLE", titles.map((t) => ({ text: t }))));
        appliedFilters.push(`Current job title: ${titles.join(", ")}`);
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
      // Real CURRENT_COMPANY filter chips, id-less (live-verified -- see the
      // header comment). Deliberately NOT folded into `keywords`: keyword
      // text matches past roles too, which is exactly the false-positive
      // this replaces. The explicit companyName param (My Accounts' per-
      // account search) is authoritative and goes first; anything the model
      // pulled out of the prompt itself is merged in after, deduped.
      const trimmedCompanyName = companyName?.trim() || "";

      // Resolve "my accounts"-style references against the rep's real
      // HubSpot book of business (same list the My Accounts page shows),
      // turning "top 3 accounts by activity" into three concrete company
      // names before they become CURRENT_COMPANY filter chips.
      const scope = parsed.accountScope;
      let resolvedAccountNames: string[] = [];
      let accountScopeNote: string | null = null;
      if (scope?.useMyAccounts) {
        try {
          const owned = await fetchOwnedAccounts(ownerEmail);
          if (owned.status !== "ok") {
            accountScopeNote =
              owned.status === "notConnected"
                ? "Couldn't scope to your accounts -- HubSpot isn't connected."
                : "Couldn't scope to your accounts -- no HubSpot owner record matches your email.";
          } else {
            let pool = owned.accounts;
            if (scope.tagQuery) {
              const narrowed = pool.filter((a) => accountMatchesTagQuery(a, scope.tagQuery!));
              // An unmatched tag phrase would otherwise silently return zero
              // accounts and produce a search scoped to nothing.
              if (narrowed.length > 0) pool = narrowed;
              else accountScopeNote = `No accounts matched "${scope.tagQuery}", so all of your accounts were used instead.`;
            }

            const rankBy = scope.rankBy ?? "name";
            const ranked = rankAccounts(pool, rankBy);
            const limit = Math.min(
              typeof scope.limit === "number" && scope.limit > 0 ? scope.limit : DEFAULT_ACCOUNT_SCOPE_LIMIT,
              MAX_COMPANIES,
            );
            const picked = ranked.slice(0, limit);
            resolvedAccountNames = picked.map((a) => a.name);

            if (rankBy === "activity" && picked.every((a) => !a.lastActivityAt)) {
              accountScopeNote =
                "None of those accounts have logged HubSpot activity, so they couldn't be ranked by activity.";
            }
          }
        } catch (err) {
          accountScopeNote = `Couldn't scope to your accounts: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      const companyNames = Array.from(
        new Set(
          [trimmedCompanyName, ...resolvedAccountNames, ...(parsed.companies ?? []).map((c) => c.trim())].filter(Boolean),
        ),
      ).slice(0, MAX_COMPANIES);
      if (companyNames.length) {
        filterEntries.push(buildFilterEntry("CURRENT_COMPANY", companyNames.map((c) => ({ text: c }))));
        appliedFilters.push(`Current company: ${companyNames.join(", ")}`);
      }

      if (!filterEntries.length && !titleKeywords) {
        return { error: "Could not generate a search from that -- try rephrasing with more specific criteria." };
      }

      const queryParts: string[] = [];
      if (filterEntries.length) queryParts.push(`filters:List(${filterEntries.join(",")})`);
      if (titleKeywords) queryParts.push(`keywords:${encodeLeaf(titleKeywords)}`);
      const rawQuery = `(${queryParts.join(",")})`;
      const searchUrl = `https://www.linkedin.com/sales/search/people?query=${encodeURIComponent(rawQuery)}`;

      // Account-scope caveats matter more than the model's own
      // unsupportedNotes here -- if "my top 3 accounts" silently resolved to
      // something other than what was asked, the rep needs to know before
      // trusting the results.
      const notes = [accountScopeNote, parsed.unsupportedNotes?.trim() || null].filter(Boolean).join(" ");

      return {
        searchUrl,
        summary: parsed.summary ?? null,
        matchedPersonaName: parsed.matchedPersonaName ?? null,
        appliedFilters,
        unsupportedNotes: notes || null,
        scopedAccounts: resolvedAccountNames.length ? resolvedAccountNames : null,
      };
    } catch {
      return { error: "Something went wrong generating that search -- try again." };
    }
  },
});
