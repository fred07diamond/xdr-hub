/**
 * Splits ICP markdown into sections and picks the ones a briefing phase
 * actually needs.
 *
 * ## Why
 *
 * All three briefing phases were handed the SAME input: the whole document
 * set, up to 60k characters. For a real persona (four documents, 5,600 words)
 * that meant the titles phase had to read every word of positioning prose,
 * call notes and messaging guidance to find the two blocks that actually list
 * job titles. It routinely did not finish inside the 19-second phase budget,
 * and the briefing came back with "target titles: completeText timed out".
 *
 * The prose phases genuinely want the whole document -- they are summarising
 * it. The TITLE phases want two or three specific sections. Giving each phase
 * only what it needs is both faster and more accurate: the model stops
 * paraphrasing titles out of an intro paragraph because the real
 * Include/Exclude block was buried 30k characters away.
 *
 * ## Fail open, always
 *
 * If the document has no headings, or nothing matches, the FULL text is
 * returned. This can make a phase no slower than it is today; it can never
 * make it see less than it does today.
 */

export interface IcpSection {
  heading: string;
  /** Heading depth, 1-6. Zero for a preamble before any heading. */
  level: number;
  body: string;
  /** Heading plus body, as it appeared. */
  raw: string;
}

/**
 * Splits on ATX markdown headings (`#` through `######`).
 *
 * Setext headings (underlined with === or ---) are not handled, deliberately:
 * ICP documents here come from Notion and .md exports, which emit ATX, and a
 * half-correct Setext parser would silently mis-split rather than fail
 * visibly.
 */
export function splitIcpSections(text: string): IcpSection[] {
  if (!text?.trim()) return [];
  const lines = text.split(/\r?\n/);
  const sections: IcpSection[] = [];
  let current: IcpSection | null = null;

  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      if (current) sections.push(current);
      current = { heading: m[2].trim(), level: m[1].length, body: "", raw: line };
      continue;
    }
    if (!current) {
      // Preamble before the first heading. Real content often lives here, so
      // it becomes its own level-0 section rather than being dropped.
      current = { heading: "", level: 0, body: "", raw: "" };
    }
    current.body += `${line}\n`;
    current.raw += `${current.raw ? "\n" : ""}${line}`;
  }
  if (current) sections.push(current);
  return sections;
}

/**
 * Terms that mark a section as being about WHO to target by title.
 *
 * Deliberately broad. A false positive costs a few hundred characters of
 * prompt; a false negative costs the whole point of the phase, which is the
 * failure being fixed.
 */
export const TITLE_SECTION_TERMS = [
  "title",
  "titles",
  "job title",
  "seniority",
  "function",
  "persona",
  "role",
  "roles",
  "who to target",
  "target",
  "buyer",
  "champion",
  "include",
  "exclude",
  "boolean",
  "search",
  "filter",
  "icp",
  "decision maker",
  "keyword",
];

/** Terms that mark a section as noise for a title extraction. */
const TITLE_SECTION_ANTI_TERMS = [
  "call notes",
  "transcript",
  "objection",
  "pricing",
  "competitor",
  "case study",
  "changelog",
];

function scoreSection(section: IcpSection, terms: string[], antiTerms: string[]): number {
  const heading = section.heading.toLowerCase();
  const body = section.body.toLowerCase();
  let score = 0;

  for (const term of terms) {
    // A hit in the HEADING is worth far more than one in the body: "Job Title
    // Include" as a heading is decisive, while the word "title" appearing once
    // inside a page of prose means almost nothing.
    if (heading.includes(term)) score += 10;
    if (body.includes(term)) score += 1;
  }
  for (const term of antiTerms) {
    if (heading.includes(term)) score -= 15;
  }
  return score;
}

export interface SelectSectionsOptions {
  /** Sections scoring at or above this are kept. */
  minScore?: number;
  /** Stop once the kept text reaches this many characters. */
  maxChars?: number;
  terms?: string[];
  antiTerms?: string[];
}

/**
 * Returns just the sections relevant to a title extraction, or the whole text
 * if that cannot be determined.
 */
export function selectTitleSections(
  text: string,
  { minScore = 10, maxChars = 14_000, terms = TITLE_SECTION_TERMS, antiTerms = TITLE_SECTION_ANTI_TERMS }: SelectSectionsOptions = {},
): { text: string; usedSections: number; totalSections: number; narrowed: boolean } {
  const all = splitIcpSections(text);
  const full = { text, usedSections: all.length, totalSections: all.length, narrowed: false };

  // No structure to exploit, or already small enough that narrowing buys
  // nothing.
  if (all.length < 2 || text.length <= 4_000) return full;

  const ranked = all
    .map((section, index) => ({ section, index, score: scoreSection(section, terms, antiTerms) }))
    .filter((r) => r.score >= minScore)
    // Highest-scoring first so the character budget goes to the most likely
    // sections, but emit in DOCUMENT order below -- an include block read
    // before its own preamble is harder to interpret, not easier.
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) return full;

  const chosen: typeof ranked = [];
  let chars = 0;
  for (const r of ranked) {
    if (chars + r.section.raw.length > maxChars && chosen.length > 0) break;
    chosen.push(r);
    chars += r.section.raw.length;
  }
  chosen.sort((a, b) => a.index - b.index);

  const narrowedText = chosen.map((r) => r.section.raw).join("\n\n");
  // Never return LESS information than the full text would have given for the
  // same cost. If narrowing saved nothing, it only added a risk of dropping
  // something.
  if (narrowedText.length >= text.length * 0.9) return full;

  return {
    text: narrowedText,
    usedSections: chosen.length,
    totalSections: all.length,
    narrowed: true,
  };
}
