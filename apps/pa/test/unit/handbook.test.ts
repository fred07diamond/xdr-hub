// The Sales handbook (D53): import parsing, versions, and search. Synthetic
// content only; the real pack is internal and never enters the repo.
import { describe, expect, it } from "vitest";

import {
  HandbookError,
  importDocs,
  indexSummaries,
  parseImportFile,
  saveDoc,
  searchDocs,
} from "../../server/core/handbook/index.js";
import { MemoryRepository } from "../../server/core/repo/memory.js";
import { fixedClock, idFactory } from "../helpers.js";

const readme = [
  "# Example pack",
  "",
  "| File | What it covers |",
  "| --- | --- |",
  "| 01_positioning.md | Positioning and naming |",
  "| 08_legacy_notes.md | Older notes |",
].join("\n");

describe("parseImportFile", () => {
  it("takes the id, title, order, and summary from the file", () => {
    const summaries = indexSummaries(readme);
    const doc = parseImportFile(
      { name: "01_positioning.md", content: "# 01. Positioning\n\nBody text." },
      summaries,
    );
    expect(doc).toMatchObject({
      id: "01-positioning",
      title: "Positioning",
      position: 1,
      status: "current",
      summary: "Positioning and naming",
    });
  });

  it("marks the README as the index and legacy docs as legacy", () => {
    expect(
      parseImportFile({ name: "00_README.md", content: readme }).status,
    ).toBe("index");
    expect(
      parseImportFile({
        name: "08_legacy_notes.md",
        content: "# 08. Old notes\n\n**LEGACY. Old names.**",
      }).status,
    ).toBe("legacy");
  });

  it("refuses files that are not Markdown or are empty", () => {
    expect(() => parseImportFile({ name: "a.pdf", content: "x" })).toThrow(
      HandbookError,
    );
    expect(() => parseImportFile({ name: "a.md", content: "  " })).toThrow(
      /empty/,
    );
  });
});

describe("importDocs and saveDoc", () => {
  it("re-importing updates changed docs, skips unchanged ones, and keeps history", async () => {
    const repo = new MemoryRepository();
    const clock = fixedClock();
    const deps = { repo, now: clock.now, newId: idFactory(clock) };
    const files = [
      { name: "00_README.md", content: readme },
      { name: "01_positioning.md", content: "# 01. Positioning\n\nOne." },
    ];
    await importDocs(deps, { actor: "a@example.com", files, source: "pack" });
    const again = await importDocs(deps, {
      actor: "a@example.com",
      files: [files[0], { ...files[1], content: "# 01. Positioning\n\nTwo." }],
      source: "pack",
    });
    expect(again).toEqual({
      added: [],
      updated: ["01-positioning"],
      unchanged: ["00-readme"],
    });
    const history = await repo.listHandbookRevisions("01-positioning");
    expect(history.map((item) => item.note)).toEqual([
      "Re-imported",
      "Imported",
    ]);

    const saved = await saveDoc(deps, {
      actor: "b@example.com",
      id: "01-positioning",
      expectedVersion: 2,
      body: "# 01. Positioning\n\nThree.",
    });
    expect(saved).toMatchObject({ version: 3, updatedBy: "b@example.com" });
    await expect(
      saveDoc(deps, {
        actor: "c@example.com",
        id: "01-positioning",
        expectedVersion: 2,
        body: "late",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("refuses two files that map to the same doc", async () => {
    const repo = new MemoryRepository();
    const clock = fixedClock();
    await expect(
      importDocs(
        { repo, now: clock.now, newId: idFactory(clock) },
        {
          actor: "a@example.com",
          source: null,
          files: [
            { name: "a/01_x.md", content: "# X" },
            { name: "b/01_x.md", content: "# X" },
          ],
        },
      ),
    ).rejects.toThrow(/same doc/);
  });
});

describe("searchDocs", () => {
  it("ranks title matches first and returns the matching line", async () => {
    const repo = new MemoryRepository();
    const clock = fixedClock();
    const deps = { repo, now: clock.now, newId: idFactory(clock) };
    await importDocs(deps, {
      actor: "a@example.com",
      source: null,
      files: [
        {
          name: "03_routing.md",
          content: "# 03. Lead routing\n\nAgencies go through partner routing.",
        },
        {
          name: "05_email.md",
          content:
            "# 05. Email playbook\n\nKeep emails short.\nMention routing once.",
        },
      ],
    });
    const hits = searchDocs(await repo.listHandbookDocs(), "routing");
    expect(hits.map((hit) => hit.id)).toEqual(["03-routing", "05-email"]);
    expect(hits[1].excerpt).toMatch(/routing/);
  });
});
