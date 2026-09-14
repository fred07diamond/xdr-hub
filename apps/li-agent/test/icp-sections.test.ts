import { describe, expect, it } from "vitest";

import {
  selectTitleSections,
  splitIcpSections,
  TITLE_SECTION_TERMS,
} from "../server/helpers/icp-sections.js";

// Reported: "target titles: completeText timed out after 19000ms" on a
// 4-document, 5,633-word persona, with the user's own diagnosis that it was
// "not categorizing the sections properly". It was not: all three briefing
// phases received the SAME full document set, so the titles phase read every
// word of positioning prose and call notes to find two title blocks.

const DOC = `
Intro paragraph with no heading at all.

# Engineering persona
Overview of who we sell to.

## Job Title Include
(VP OR Director OR Head) AND ("platform engineering" OR "developer experience")

## Job Title Exclude
Recruiter, Student, Intern

## Call notes from Aug 14
${"Long transcript text. ".repeat(200)}

## Pricing objections
${"Pricing discussion. ".repeat(200)}
`;

describe("splitIcpSections", () => {
  it("keeps preamble before the first heading as its own section", () => {
    // Real content often lives up there; dropping it would lose it silently.
    const sections = splitIcpSections(DOC);
    expect(sections[0].level).toBe(0);
    expect(sections[0].body).toContain("Intro paragraph");
  });

  it("records heading depth", () => {
    const sections = splitIcpSections(DOC);
    expect(sections.find((s) => s.heading === "Engineering persona")?.level).toBe(1);
    expect(sections.find((s) => s.heading === "Job Title Include")?.level).toBe(2);
  });

  it("returns nothing for empty input rather than one empty section", () => {
    expect(splitIcpSections("")).toEqual([]);
    expect(splitIcpSections("   ")).toEqual([]);
  });

  it("does not treat a mid-line hash as a heading", () => {
    const sections = splitIcpSections("# Real\nnot # a heading\n");
    expect(sections).toHaveLength(1);
    expect(sections[0].body).toContain("not # a heading");
  });
});

describe("selectTitleSections", () => {
  it("keeps the title blocks and drops the transcript and pricing", () => {
    const out = selectTitleSections(DOC);
    expect(out.narrowed).toBe(true);
    expect(out.text).toContain("Job Title Include");
    expect(out.text).toContain("Job Title Exclude");
    expect(out.text).not.toContain("Long transcript text");
    expect(out.text).not.toContain("Pricing discussion");
  });

  it("cuts the prompt down substantially", () => {
    // The whole point: the titles phase stops having to read 35k characters
    // to find two blocks.
    const out = selectTitleSections(DOC);
    expect(out.text.length).toBeLessThan(DOC.length * 0.3);
  });

  it("emits sections in DOCUMENT order, not score order", () => {
    // An include block read before its own preamble is harder to interpret,
    // not easier.
    const out = selectTitleSections(DOC);
    expect(out.text.indexOf("Job Title Include")).toBeLessThan(out.text.indexOf("Job Title Exclude"));
  });

  it("FAILS OPEN to the full text when there are no headings", () => {
    // This can make a phase no slower than it is today; it must never make it
    // see less than it does today.
    const flat = "Just prose about titles and seniority. ".repeat(200);
    const out = selectTitleSections(flat);
    expect(out.narrowed).toBe(false);
    expect(out.text).toBe(flat);
  });

  it("FAILS OPEN when nothing scores high enough", () => {
    const irrelevant = `# Changelog\n${"release notes ".repeat(500)}\n# Pricing\n${"cost ".repeat(500)}`;
    const out = selectTitleSections(irrelevant);
    expect(out.narrowed).toBe(false);
    expect(out.text).toBe(irrelevant);
  });

  it("does not bother narrowing a small document", () => {
    // Narrowing buys nothing below the point where the phase was ever slow,
    // and only adds a chance of dropping something.
    const small = "# Job Title Include\nVP Engineering\n";
    expect(selectTitleSections(small).narrowed).toBe(false);
  });

  it("returns the full text when narrowing would save almost nothing", () => {
    // If 90%+ survives, the risk of having dropped something is not paid for.
    const mostlyTitles = `# Job Titles\n${"VP Engineering, Director of Platform. ".repeat(300)}`;
    const out = selectTitleSections(mostlyTitles);
    expect(out.narrowed).toBe(false);
  });

  it("respects the character budget but always keeps at least one section", () => {
    const huge = `# Job Title Include\n${"VP Engineering ".repeat(5000)}\n# Seniority\n${"Director ".repeat(5000)}`;
    const out = selectTitleSections(huge, { maxChars: 500 });
    expect(out.usedSections).toBeGreaterThanOrEqual(1);
  });

  it("scores a heading hit far above a body hit", () => {
    // "Job Title Include" as a heading is decisive; the word "title" once
    // inside a page of prose means almost nothing.
    const doc = `# Job Titles\nVP Eng\n\n# Random\n${"the word title appears here ".repeat(300)}`;
    const out = selectTitleSections(doc);
    expect(out.text).toContain("Job Titles");
  });

  it("covers the vocabulary a real ICP uses for targeting", () => {
    for (const term of ["title", "seniority", "function", "include", "exclude", "boolean"]) {
      expect(TITLE_SECTION_TERMS).toContain(term);
    }
  });
});
