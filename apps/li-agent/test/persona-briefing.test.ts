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

  it("clamps list length and item length", async () => {
    reply({
      ...FULL,
      titles: Array.from({ length: 30 }, (_, i) => `Title ${i}`),
      painPoints: ["x".repeat(500)],
    });
    const b = (await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" }))!;
    expect(b.titles).toHaveLength(8);
    expect(b.painPoints[0].length).toBe(240);
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
    reply({ titles: [], whyTheyBuy: [], orgPriorities: [], coverageGaps: ["Documents are too thin"] });
    await expect(
      buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" }),
    ).rejects.toThrow(/empty briefing/);
  });

  it("caps how much ICP text is sent to the model", async () => {
    reply(FULL);
    await buildPersonaBriefing({ personaName: "VP Eng", icpText: "y".repeat(50_000) });
    expect(completeText.mock.calls[0][0].input.length).toBeLessThan(13_000);
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
