import { completeText } from "@agent-native/core/server";

export const LIBRARY_CATEGORIES = [
  "icp",
  "persona_messaging",
  "sales_process",
  "campaigns",
  "tools",
  "positioning",
  "other",
] as const;

export type LibraryCategory = (typeof LIBRARY_CATEGORIES)[number];

export interface DerivedLibraryTags {
  category: LibraryCategory;
  tags: string[];
}

// One completeText() call, factored into a plain function (not inline in
// the action) so both create-library-doc.ts and update-library-doc.ts can
// call it. Grounded only in the document's own text — never invents a
// category or tag the text doesn't actually support.
//
// Unlike derive-prospector-filters.ts's helper (which is also called as a
// nested function outside the action-route request boundary), this is only
// ever called from within an action's own `run()`, which the framework's
// action-routes already wraps in `runWithRequestContext` — so no additional
// context wrap is needed here; completeText() reads the ambient context.
export async function deriveLibraryTags(text: string): Promise<DerivedLibraryTags> {
  const systemPrompt =
    "You read a sales team's internal reference document and categorize it for their Sales Library, for an outbound prospecting pipeline.\n\n" +
    `Document text:\n${text.slice(0, 4000)}\n\n` +
    "Categorize:\n" +
    `- category: exactly one of ${LIBRARY_CATEGORIES.map((c) => `"${c}"`).join(", ")} — pick "other" if nothing else fits. Base this ONLY on what the document text actually discusses.\n` +
    '- tags: up to 6 short, specific tags grounded only in what the document actually discusses (e.g. "Call Script", "Firmographics", "Objection Handling", "Pricing") — never invent a tag the text doesn\'t support.\n\n' +
    'Reply with valid JSON only: { "category": "<one of the categories above>", "tags": ["...", ...] }';

  const result = await completeText({ systemPrompt, input: "Categorize this document.", maxOutputTokens: 300 });

  const raw = result.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Unparseable library tagging response: ${raw.slice(0, 200)}`);
  }

  const category: LibraryCategory =
    typeof parsed.category === "string" && (LIBRARY_CATEGORIES as readonly string[]).includes(parsed.category)
      ? (parsed.category as LibraryCategory)
      : "other";

  const tags = Array.isArray(parsed.tags)
    ? parsed.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0).slice(0, 6)
    : [];

  return { category, tags };
}
