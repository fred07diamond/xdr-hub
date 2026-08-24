import { beforeEach, describe, expect, it, vi } from "vitest";

// buildPersonaBriefing's only real dependency is completeText. getOwnerCtx is
// stubbed too: it reaches @agent-native/core/org for LLM attribution, whose
// OpenTelemetry dependency can't be resolved under vitest's ESM runner.
const completeText = vi.fn();
vi.mock("@agent-native/core/server", () => ({
  completeText: (...args: unknown[]) => completeText(...args),
  runWithRequestContext: (_ctx: unknown, fn: () => unknown) => fn(),
}));
vi.mock("../server/helpers/get-owner-ctx.js", () => ({ getOwnerCtx: async () => null }));

const { buildPersonaBriefing, hashIcpText } = await import("../server/helpers/persona-briefing.js");

const FULL = {
  positioning: "Senior engineering leaders at mid-market SaaS companies.",
  titles: ["VP Engineering", "Head of Platform"],
  fallbackTitles: ["Director of Platform"],
  avoidTitles: ["Engineering Manager"],
  orgPriorities: ["Delivery velocity", "Platform reliability"],
  whyTheyBuy: ["Shipping is blocked on manual review"],
  painPoints: ["Reviews queue for days"],
  voice: { tone: "Direct and technical.", dos: ["Cite a real metric"], donts: ["Avoid hype"] },
  openingAngles: ["Their post about review latency"],
  coverageGaps: ["No budget or procurement detail"],
};

function reply(payload: unknown, wrap?: "fence") {
  const json = typeof payload === "string" ? payload : JSON.stringify(payload);
  completeText.mockResolvedValueOnce({ text: wrap === "fence" ? "```json\n" + json + "\n```" : json });
}

describe("buildPersonaBriefing", () => {
  beforeEach(() => { completeText.mockReset(); });

  it("returns null without calling the model when the persona has no documents", async () => {
    expect(await buildPersonaBriefing({ personaName: "VP Eng", icpText: null })).toBeNull();
    expect(await buildPersonaBriefing({ personaName: "VP Eng", icpText: "   " })).toBeNull();
    expect(completeText).not.toHaveBeenCalled();
  });

  it("maps every section of a well-formed response", async () => {
    reply(FULL);
    const b = (await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" }))!;

    expect(b.titles).toEqual(["VP Engineering", "Head of Platform"]);
    expect(b.fallbackTitles).toEqual(["Director of Platform"]);
    expect(b.avoidTitles).toEqual(["Engineering Manager"]);
    expect(b.orgPriorities).toEqual(["Delivery velocity", "Platform reliability"]);
    expect(b.whyTheyBuy).toEqual(["Shipping is blocked on manual review"]);
    expect(b.voice).toEqual({
      tone: "Direct and technical.",
      dos: ["Cite a real metric"],
      donts: ["Avoid hype"],
    });
    expect(b.coverageGaps).toEqual(["No budget or procurement detail"]);
  });

  it("instructs the model not to invent criteria and to name gaps instead", async () => {
    reply(FULL);
    await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" });
    const { systemPrompt } = completeText.mock.calls[0][0];
    expect(systemPrompt).toContain("Do not invent");
    expect(systemPrompt).toContain("coverageGaps");
  });

  it("strips em dashes from every generated string", async () => {
    // CLAUDE.md hard rule: no em dashes in anything this app generates. The
    // prompt says so and the output is sanitized as a backstop.
    reply({
      ...FULL,
      positioning: "Senior leaders — usually post-Series B.",
      titles: ["VP Engineering — Platform"],
      whyTheyBuy: ["Manual review — the real blocker"],
      voice: { tone: "Direct — never salesy.", dos: ["Be concrete — cite a metric"], donts: ["No hype — ever"] },
      coverageGaps: ["Budget — not covered"],
    });
    const b = (await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" }))!;

    const everyString = [
      b.positioning,
      ...b.titles,
      ...b.whyTheyBuy,
      b.voice.tone,
      ...b.voice.dos,
      ...b.voice.donts,
      ...b.coverageGaps,
    ];
    for (const value of everyString) expect(value).not.toContain("—");
    expect(b.positioning).toBe("Senior leaders, usually post-Series B.");

    // And the model is told directly, not only sanitized afterward.
    expect(completeText.mock.calls[0][0].systemPrompt).toContain("Never use em dashes");
  });

  it("handles a fenced ```json response", async () => {
    reply(FULL, "fence");
    const b = await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" });
    expect(b?.titles).toEqual(["VP Engineering", "Head of Platform"]);
  });

  it("tolerates missing and wrong-typed sections", async () => {
    reply({ positioning: "Just a positioning line.", titles: "not an array" });
    const b = (await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" }))!;
    expect(b.positioning).toBe("Just a positioning line.");
    expect(b.titles).toEqual([]);
    expect(b.voice).toEqual({ tone: "", dos: [], donts: [] });
    expect(b.coverageGaps).toEqual([]);
  });

  it("keeps title lists long and prose lists short", async () => {
    // A boolean include block of (5 seniority) AND (13 function) terms expands
    // well past the 8 items prose sections are capped at; clamping titles that
    // hard silently dropped targets the team prospects by.
    reply({
      ...FULL,
      titles: Array.from({ length: 40 }, (_, i) => `Title ${i}`),
      avoidTitles: Array.from({ length: 40 }, (_, i) => `Avoid ${i}`),
      painPoints: Array.from({ length: 40 }, (_, i) => `Pain ${i}`),
    });
    const b = (await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" }))!;
    expect(b.titles).toHaveLength(30);
    expect(b.avoidTitles).toHaveLength(30);
    expect(b.painPoints).toHaveLength(8);
  });

  it("truncates an over-long item", async () => {
    reply({ ...FULL, painPoints: ["x".repeat(500)] });
    const b = (await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" }))!;
    expect(b.painPoints[0].length).toBe(240);
  });

  it("dedupes titles case-insensitively", async () => {
    // Expanding a boolean cross product reliably repeats a title, and a repeat
    // is also a duplicate React key in the briefing sheet.
    reply({ ...FULL, titles: ["VP of Design", "VP of Design", "vp of design", "Head of Design"] });
    const b = (await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" }))!;
    expect(b.titles).toEqual(["VP of Design", "Head of Design"]);
  });

  it("instructs the model to mine an explicit title list and expand booleans", async () => {
    // The regression this guards: the ICP carries an authoritative
    // "Job Title (Include)" boolean block and the briefing paraphrased a
    // handful of titles from the prose intro instead of reading it.
    reply(FULL);
    await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" });
    const { systemPrompt } = completeText.mock.calls[0][0];
    expect(systemPrompt).toContain("Job Title (Include)");
    expect(systemPrompt).toContain("AUTHORITATIVE");
    expect(systemPrompt).toContain("Expand a boolean cross product");
    expect(systemPrompt).toContain("fallbackTitles");
  });

  it("throws rather than persisting an unparseable response", async () => {
    reply("this is not json at all");
    await expect(
      buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" }),
    ).rejects.toThrow(/did not return a usable briefing/);
  });

  it("throws rather than persisting a contentless briefing", async () => {
    // Guards the caller's contract: generate-persona-briefing leaves the
    // previous briefing in place on failure, so an all-empty response must
    // fail loudly instead of overwriting a good briefing with nothing.
    reply({
      titles: [],
      fallbackTitles: [],
      whyTheyBuy: [],
      orgPriorities: [],
      coverageGaps: ["Documents are too thin"],
    });
    await expect(
      buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" }),
    ).rejects.toThrow(/empty briefing/);
  });

  it("sends a real multi-document ICP whole, rather than cutting off its filter blocks", async () => {
    // The original 12k window truncated a three-document persona before its
    // Job Title Include/Exclude blocks, which sit near the end -- so the
    // briefing could not have used them even with a perfect prompt.
    const icpText = "y".repeat(40_000) + "\n\nJob Title (Include): VP OR Head";
    reply(FULL);
    await buildPersonaBriefing({ personaName: "VP Eng", icpText });
    expect(completeText.mock.calls[0][0].input).toContain("Job Title (Include)");
  });

  it("tells the model when an ICP really is too long to fit", async () => {
    reply(FULL);
    await buildPersonaBriefing({ personaName: "VP Eng", icpText: "y".repeat(80_000) });
    const { input } = completeText.mock.calls[0][0];
    expect(input).toContain("truncated");
    expect(input).toContain("coverageGaps");
  });
});

describe("hashIcpText", () => {
  it("is stable for identical text and changes when a document is added", async () => {
    const oneDoc = "## a.md\n\nTarget VPs.";
    const twoDocs = "## a.md\n\nTarget VPs.\n\n---\n\n## b.md\n\nSkip agencies.";

    expect(hashIcpText(oneDoc)).toBe(hashIcpText(oneDoc));
    // This inequality is what marks a briefing stale in list-icp-personas.
    expect(hashIcpText(oneDoc)).not.toBe(hashIcpText(twoDocs));
  });
});
