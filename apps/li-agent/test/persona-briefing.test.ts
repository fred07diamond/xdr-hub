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

// buildPersonaBriefing makes TWO concurrent calls -- titles first, then prose
// (deterministic: each runPhase reaches completeText synchronously, in array
// order). `reply` queues one response; `replyBoth` splits a combined payload
// into the two halves each phase actually returns, so the tests below can keep
// describing a briefing as one object.
const TITLE_FIELDS = ["titles", "fallbackTitles", "avoidTitles", "avoidTitlesSearch"] as const;

function reply(payload: unknown, wrap?: "fence") {
  const json = typeof payload === "string" ? payload : JSON.stringify(payload);
  completeText.mockResolvedValueOnce({ text: wrap === "fence" ? "```json\n" + json + "\n```" : json });
}

function replyBoth(payload: Record<string, unknown>, wrap?: "fence") {
  const titles: Record<string, unknown> = {};
  const prose: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if ((TITLE_FIELDS as readonly string[]).includes(key)) titles[key] = value;
    else prose[key] = value;
  }
  // Both shapes declare coverageGaps (each scoped to its own half) and the
  // merge unions + dedupes them, so echoing it into both mirrors reality
  // without changing what the assertions see.
  if ("coverageGaps" in payload) titles.coverageGaps = payload.coverageGaps;
  reply(titles, wrap);
  reply(prose, wrap);
}

describe("buildPersonaBriefing", () => {
  beforeEach(() => { completeText.mockReset(); });

  it("returns null without calling the model when the persona has no documents", async () => {
    expect(await buildPersonaBriefing({ personaName: "VP Eng", icpText: null })).toBeNull();
    expect(await buildPersonaBriefing({ personaName: "VP Eng", icpText: "   " })).toBeNull();
    expect(completeText).not.toHaveBeenCalled();
  });

  it("maps every section of a well-formed response", async () => {
    replyBoth(FULL);
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
    replyBoth(FULL);
    await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" });
    const { systemPrompt } = completeText.mock.calls[0][0];
    expect(systemPrompt).toContain("Do not invent");
    expect(systemPrompt).toContain("coverageGaps");
  });

  it("strips em dashes from every generated string", async () => {
    // CLAUDE.md hard rule: no em dashes in anything this app generates. The
    // prompt says so and the output is sanitized as a backstop.
    replyBoth({
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
    replyBoth(FULL, "fence");
    const b = await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" });
    expect(b?.titles).toEqual(["VP Engineering", "Head of Platform"]);
  });

  it("tolerates missing and wrong-typed sections", async () => {
    replyBoth({ positioning: "Just a positioning line.", titles: "not an array" });
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
    replyBoth({
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
    replyBoth({ ...FULL, painPoints: ["x".repeat(500)] });
    const b = (await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" }))!;
    expect(b.painPoints[0].length).toBe(240);
  });

  it("dedupes titles case-insensitively", async () => {
    // Expanding a boolean cross product reliably repeats a title, and a repeat
    // is also a duplicate React key in the briefing sheet.
    replyBoth({ ...FULL, titles: ["VP of Design", "VP of Design", "vp of design", "Head of Design"] });
    const b = (await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" }))!;
    expect(b.titles).toEqual(["VP of Design", "Head of Design"]);
  });

  it("instructs the model to mine an explicit title list and expand booleans", async () => {
    // The regression this guards: the ICP carries an authoritative
    // "Job Title (Include)" boolean block and the briefing paraphrased a
    // handful of titles from the prose intro instead of reading it.
    replyBoth(FULL);
    await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" });
    const { systemPrompt } = completeText.mock.calls[0][0];
    expect(systemPrompt).toContain("Job Title (Include)");
    expect(systemPrompt).toContain("AUTHORITATIVE");
    expect(systemPrompt).toContain("Expand a boolean cross product");
    expect(systemPrompt).toContain("fallbackTitles");
  });

  it("throws rather than persisting an unparseable response", async () => {
    // Both halves have to be unusable for this to be a hard failure -- one
    // surviving half is a partial briefing, covered separately below.
    reply("this is not json at all");
    reply("neither is this");
    await expect(
      buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" }),
    ).rejects.toThrow(/did not return a usable briefing/);
  });

  it("throws rather than persisting a contentless briefing", async () => {
    // Guards the caller's contract: generate-persona-briefing leaves the
    // previous briefing in place on failure, so an all-empty response must
    // fail loudly instead of overwriting a good briefing with nothing.
    replyBoth({
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
    replyBoth(FULL);
    await buildPersonaBriefing({ personaName: "VP Eng", icpText });
    expect(completeText.mock.calls[0][0].input).toContain("Job Title (Include)");
  });

  it("tells the model when an ICP really is too long to fit", async () => {
    replyBoth(FULL);
    await buildPersonaBriefing({ personaName: "VP Eng", icpText: "y".repeat(80_000) });
    const { input } = completeText.mock.calls[0][0];
    expect(input).toContain("truncated");
    expect(input).toContain("coverageGaps");
  });

  // ── The generate-briefing timeout regression ───────────────────────────────
  // A large persona used to be asked for exhaustive titles AND eight prose
  // sections in ONE 8000-token call, which hit the cap, fired the truncation
  // retry (a second full-size call), and blew past the ~40s hosted-run wall.
  // Nothing was ever returned, so the browser got a proxy "Inactivity
  // Timeout" HTML page instead of JSON and the button looked inert.

  it("bounds every model call with a timeout", async () => {
    // The root cause: completeText has no default internal timeout, so an
    // omitted timeoutMs is an unbounded hang, and this action holds the HTTP
    // response open for its whole duration.
    replyBoth(FULL);
    await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" });
    expect(completeText.mock.calls.length).toBeGreaterThan(0);
    for (const [args] of completeText.mock.calls) {
      expect(typeof args.timeoutMs).toBe("number");
      expect(args.timeoutMs).toBeGreaterThan(0);
    }
  });

  it("splits the work into exactly two calls whose timeouts fit the hosted-run wall", async () => {
    replyBoth(FULL);
    await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" });

    expect(completeText).toHaveBeenCalledTimes(2);
    // Concurrent, so the wall-clock cost is the slower phase, not the sum --
    // but even summed the two phases must stay under the 40s ceiling that
    // core's durable-agent-runs design doc pins as the safe budget.
    const total = completeText.mock.calls.reduce((n, [args]) => n + args.timeoutMs, 0);
    expect(total).toBeLessThanOrEqual(40_000);
  });

  it("gives each phase an output cap well under the single call's 8000", async () => {
    // Headroom is what keeps the truncation retry off the normal path for a
    // large persona; at 8000 for the combined response it was the normal path.
    replyBoth(FULL);
    await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" });
    for (const [args] of completeText.mock.calls) {
      expect(args.maxOutputTokens).toBeLessThan(8000);
    }
  });

  it("scopes each phase's prompt to its own half", async () => {
    replyBoth(FULL);
    await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" });
    const [titlesPrompt, prosePrompt] = completeText.mock.calls.map((c) => c[0].systemPrompt);

    // The authoritative-title-list rules belong to the titles phase only;
    // duplicating them into the prose phase is what made one call too big.
    expect(titlesPrompt).toContain("Expand a boolean cross product");
    expect(prosePrompt).not.toContain("Expand a boolean cross product");
    expect(prosePrompt).toContain("openingAngles");
    expect(titlesPrompt).not.toContain("openingAngles");
  });

  it("keeps one phase's result when the other fails, and names the gap", async () => {
    // Losing a whole briefing because the prose half timed out would be worse
    // than shipping the titles half -- generate-sales-nav-search.ts consumes
    // avoidTitlesSearch, so the titles are independently useful.
    reply({ titles: ["VP Engineering"], avoidTitlesSearch: ["Engineering Manager"] });
    reply("prose came back unparseable");
    const b = (await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" }))!;

    expect(b.titles).toEqual(["VP Engineering"]);
    expect(b.avoidTitlesSearch).toEqual(["Engineering Manager"]);
    expect(b.whyTheyBuy).toEqual([]);
    expect(b.coverageGaps.join(" ")).toMatch(/messaging guidance could not be generated/i);
  });

  it("survives a phase that throws outright, not just one that returns junk", async () => {
    // A timeout or provider error rejects rather than resolving; allSettled is
    // what keeps that from discarding the half that did come back.
    completeText.mockRejectedValueOnce(new Error("completeText timed out after 20000ms"));
    reply({ positioning: "Senior engineering leaders.", whyTheyBuy: ["Review latency"] });
    const b = (await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" }))!;

    expect(b.positioning).toBe("Senior engineering leaders.");
    expect(b.titles).toEqual([]);
    expect(b.coverageGaps.join(" ")).toMatch(/target job titles could not be generated/i);
  });

  it("retries a phase that was cut off at the token cap, without redoing the other", async () => {
    // Queue order is CALL order, and the phases are concurrent: both first
    // attempts fire before either retry, so the titles retry is call 3, not
    // call 2.
    completeText.mockResolvedValueOnce({ text: '{"titles": ["VP Eng', stopReason: "max_tokens" });
    reply({ positioning: "Senior engineering leaders." }); // prose phase, unaffected
    reply({ titles: ["VP Engineering"] }); // titles phase, second attempt
    const b = (await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" }))!;

    expect(b.titles).toEqual(["VP Engineering"]);
    expect(b.positioning).toBe("Senior engineering leaders.");
    expect(completeText).toHaveBeenCalledTimes(3);
    // The retry is the constrained pass, and still bounded.
    const retry = completeText.mock.calls.find(([a]) => a.systemPrompt.includes("cut off"))![0];
    expect(retry.timeoutMs).toBeGreaterThan(0);
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
