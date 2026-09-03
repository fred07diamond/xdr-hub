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

// buildPersonaBriefing makes THREE concurrent calls, in this order
// (deterministic: each runPhase reaches completeText synchronously, in array
// order): target titles, excluded titles, then messaging. `reply` queues one
// response; `replyAll` splits a combined payload into the three slices each
// phase actually returns, so the tests below can keep describing a briefing
// as one object.
const INCLUDE_FIELDS = ["titles", "fallbackTitles"] as const;
const EXCLUDE_FIELDS = ["avoidTitles", "avoidTitlesSearch"] as const;

function reply(payload: unknown, wrap?: "fence") {
  const json = typeof payload === "string" ? payload : JSON.stringify(payload);
  completeText.mockResolvedValueOnce({ text: wrap === "fence" ? "```json\n" + json + "\n```" : json });
}

function replyAll(payload: Record<string, unknown>, wrap?: "fence") {
  const include: Record<string, unknown> = {};
  const exclude: Record<string, unknown> = {};
  const prose: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if ((INCLUDE_FIELDS as readonly string[]).includes(key)) include[key] = value;
    else if ((EXCLUDE_FIELDS as readonly string[]).includes(key)) exclude[key] = value;
    else prose[key] = value;
  }
  // All three shapes declare coverageGaps (each scoped to its own phase) and
  // the merge unions + dedupes them, so echoing it into each mirrors reality
  // without changing what the assertions see.
  if ("coverageGaps" in payload) {
    include.coverageGaps = payload.coverageGaps;
    exclude.coverageGaps = payload.coverageGaps;
  }
  reply(include, wrap);
  reply(exclude, wrap);
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
    replyAll(FULL);
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
    replyAll(FULL);
    await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" });
    const { systemPrompt } = completeText.mock.calls[0][0];
    expect(systemPrompt).toContain("Do not invent");
    expect(systemPrompt).toContain("coverageGaps");
  });

  it("strips em dashes from every generated string", async () => {
    // CLAUDE.md hard rule: no em dashes in anything this app generates. The
    // prompt says so and the output is sanitized as a backstop.
    replyAll({
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
    replyAll(FULL, "fence");
    const b = await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" });
    expect(b?.titles).toEqual(["VP Engineering", "Head of Platform"]);
  });

  it("tolerates missing and wrong-typed sections", async () => {
    replyAll({ positioning: "Just a positioning line.", titles: "not an array" });
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
    replyAll({
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
    replyAll({ ...FULL, painPoints: ["x".repeat(500)] });
    const b = (await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" }))!;
    expect(b.painPoints[0].length).toBe(240);
  });

  it("dedupes titles case-insensitively", async () => {
    // Expanding a boolean cross product reliably repeats a title, and a repeat
    // is also a duplicate React key in the briefing sheet.
    replyAll({ ...FULL, titles: ["VP of Design", "VP of Design", "vp of design", "Head of Design"] });
    const b = (await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" }))!;
    expect(b.titles).toEqual(["VP of Design", "Head of Design"]);
  });

  it("instructs the model to mine an explicit title list and expand booleans", async () => {
    // The regression this guards: the ICP carries an authoritative
    // "Job Title (Include)" boolean block and the briefing paraphrased a
    // handful of titles from the prose intro instead of reading it.
    replyAll(FULL);
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
    ).rejects.toThrow(/Could not generate the briefing/);
  });

  it("reports WHY both phases failed, not just that they did", async () => {
    // This message is the user's only signal. A fixed "try again" string sent
    // a real provider failure (exhausted quota, bad key, timeout) back as
    // something indistinguishable from a transient blip, and cost a full
    // deploy-and-retry cycle to learn what had actually gone wrong.
    completeText.mockRejectedValueOnce(new Error("insufficient credits for this workspace"));
    completeText.mockRejectedValueOnce(new Error("model overloaded"));
    completeText.mockRejectedValueOnce(new Error("completeText timed out after 16000ms"));

    await expect(
      buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" }),
    ).rejects.toThrow(/insufficient credits[\s\S]*overloaded[\s\S]*timed out after 16000ms/);
  });

  it("carries a failed phase's real reason into the briefing it still returns", async () => {
    reply({ titles: ["VP Engineering"] });
    completeText.mockRejectedValueOnce(new Error("model overloaded, please retry"));
    const b = (await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" }))!;

    expect(b.titles).toEqual(["VP Engineering"]);
    expect(b.coverageGaps.join(" ")).toContain("model overloaded");
  });

  it("throws rather than persisting a contentless briefing", async () => {
    // Guards the caller's contract: generate-persona-briefing leaves the
    // previous briefing in place on failure, so an all-empty response must
    // fail loudly instead of overwriting a good briefing with nothing.
    replyAll({
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
    replyAll(FULL);
    await buildPersonaBriefing({ personaName: "VP Eng", icpText });
    expect(completeText.mock.calls[0][0].input).toContain("Job Title (Include)");
  });

  it("tells the model when an ICP really is too long to fit", async () => {
    replyAll(FULL);
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
    replyAll(FULL);
    await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" });
    expect(completeText.mock.calls.length).toBeGreaterThan(0);
    for (const [args] of completeText.mock.calls) {
      expect(typeof args.timeoutMs).toBe("number");
      expect(args.timeoutMs).toBeGreaterThan(0);
    }
  });

  it("splits the work into three calls whose budget fits UNDER the proxy threshold", async () => {
    replyAll(FULL);
    await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" });

    expect(completeText).toHaveBeenCalledTimes(3);
    // The phases are concurrent, so wall-clock is the SLOWEST phase, not the
    // sum -- asserting the sum would wrongly force each phase down to a third
    // of the budget. The binding limit is NOT core's 40s: the proxy in front
    // of the function was observed giving up in the low 20s (a 28s phase
    // budget produced an "Inactivity Timeout" HTML page instead of any
    // response, where 20s produced this code's own error). A phase plus its
    // retry has to stay under that, or a reportable failure becomes an
    // unreadable one.
    // 20s was observed still returning this code's own error, so the budget
    // must stay on the safe side of that -- and a retry can only follow a
    // first attempt that already returned fast, so the pair must also fit.
    const slowestPhase = Math.max(...completeText.mock.calls.map(([args]) => args.timeoutMs));
    expect(slowestPhase).toBeLessThan(20_000);
    expect(slowestPhase + 5_000).toBeLessThan(25_000);
  });

  it("gives each phase an output cap well under the single call's 8000", async () => {
    // Headroom is what keeps the truncation retry off the normal path for a
    // large persona; at 8000 for the combined response it was the normal path.
    replyAll(FULL);
    await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" });
    for (const [args] of completeText.mock.calls) {
      expect(args.maxOutputTokens).toBeLessThan(8000);
    }
  });

  it("scopes each phase's prompt to its own slice", async () => {
    replyAll(FULL);
    await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" });
    const [includePrompt, excludePrompt, prosePrompt] = completeText.mock.calls.map(
      (c) => c[0].systemPrompt,
    );

    // Cross-product expansion belongs to the target-titles phase; the long
    // flattening rules belong to the excluded-titles phase. Carrying both in
    // one call is what made the title phase time out for every persona.
    expect(includePrompt).toContain("Expand a boolean cross product");
    expect(excludePrompt).not.toContain("Expand a boolean cross product");
    expect(excludePrompt).toContain("avoidTitlesSearch");
    expect(includePrompt).not.toContain("avoidTitlesSearch");
    // And neither title phase carries the prose sections.
    expect(prosePrompt).toContain("openingAngles");
    expect(includePrompt).not.toContain("openingAngles");
    expect(excludePrompt).not.toContain("openingAngles");
  });

  it("tells the model the same list cap the code actually keeps", async () => {
    // The prompt used to demand an unbounded "be exhaustive" expansion while
    // cleanList silently discarded everything past MAX_TITLE_ITEMS, so the
    // model burned its whole budget generating titles that were thrown away.
    replyAll(FULL);
    await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" });
    const [includePrompt, excludePrompt] = completeText.mock.calls.map((c) => c[0].systemPrompt);

    for (const prompt of [includePrompt, excludePrompt]) {
      expect(prompt).toContain("AT MOST 30 entries per list");
      expect(prompt).not.toContain("Be exhaustive");
    }
  });

  it("keeps the phases that succeed when one fails, and names the gap", async () => {
    // Losing a whole briefing because one phase timed out would be worse than
    // shipping the rest -- generate-sales-nav-search.ts consumes
    // avoidTitlesSearch, so the titles are independently useful.
    reply({ titles: ["VP Engineering"] });
    reply({ avoidTitlesSearch: ["Engineering Manager"] });
    reply("prose came back unparseable");
    const b = (await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" }))!;

    expect(b.titles).toEqual(["VP Engineering"]);
    expect(b.avoidTitlesSearch).toEqual(["Engineering Manager"]);
    expect(b.whyTheyBuy).toEqual([]);
    expect(b.coverageGaps.join(" ")).toMatch(/messaging guidance could not be generated/i);
  });

  it("survives a phase that throws outright, not just one that returns junk", async () => {
    // A timeout or provider error rejects rather than resolving; runPhase
    // catching it is what keeps that from discarding the phases that did come
    // back. This is the exact live failure: the title phase timed out and the
    // briefing was stored with its job titles missing.
    completeText.mockRejectedValueOnce(new Error("completeText timed out after 16000ms"));
    reply({ avoidTitles: ["Engineering Manager"] });
    reply({ positioning: "Senior engineering leaders.", whyTheyBuy: ["Review latency"] });
    const b = (await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" }))!;

    expect(b.positioning).toBe("Senior engineering leaders.");
    expect(b.avoidTitles).toEqual(["Engineering Manager"]);
    expect(b.titles).toEqual([]);
    expect(b.coverageGaps.join(" ")).toMatch(/target job titles could not be generated/i);
    expect(b.coverageGaps.join(" ")).toContain("timed out after 16000ms");
  });

  it("retries a phase that was cut off at the token cap, without redoing the others", async () => {
    // Queue order is CALL order, and the phases are concurrent: ALL three
    // first attempts fire before any retry, so the retry is call 4.
    completeText.mockResolvedValueOnce({ text: '{"titles": ["VP Eng', stopReason: "max_tokens" });
    reply({ avoidTitles: ["Engineering Manager"] }); // exclude phase, unaffected
    reply({ positioning: "Senior engineering leaders." }); // prose phase, unaffected
    reply({ titles: ["VP Engineering"] }); // include phase, second attempt
    const b = (await buildPersonaBriefing({ personaName: "VP Eng", icpText: "ICP text" }))!;

    expect(b.titles).toEqual(["VP Engineering"]);
    expect(b.avoidTitles).toEqual(["Engineering Manager"]);
    expect(b.positioning).toBe("Senior engineering leaders.");
    // 3 first attempts + 1 retry: the other two phases are not re-run.
    expect(completeText).toHaveBeenCalledTimes(4);
    // The retry is the constrained pass, and still bounded.
    const retry = completeText.mock.calls.find(([a]) => a.systemPrompt.includes("cut off"))![0];
    expect(retry.timeoutMs).toBeGreaterThan(0);
    expect(retry.timeoutMs).toBeLessThanOrEqual(6_000);
  });
});

// ── Gap fill on regenerate ───────────────────────────────────────────────────
// Generation is split across three model calls and any one can time out, so
// "Regenerate to fill them in" has to actually close the gap. Before this, a
// regenerate re-ran all three phases and overwrote the stored briefing with
// the new partial -- so a run that recovered messaging but lost titles traded
// one gap for another and could churn forever.
describe("buildPersonaBriefing gap fill", () => {
  beforeEach(() => { completeText.mockReset(); });

  const PRIOR = {
    positioning: "",
    titles: ["VP of Product"],
    fallbackTitles: ["Director of Product"],
    avoidTitles: [],
    avoidTitlesSearch: [],
    orgPriorities: [],
    whyTheyBuy: [],
    painPoints: [],
    voice: { tone: "", dos: [], donts: [] },
    openingAngles: [],
    coverageGaps: [
      "Messaging guidance could not be generated this run (messaging: completeText timed out after 16000ms). Regenerate to fill it in.",
      "The documents do not define pricing or procurement",
    ],
  };

  it("skips phases the stored briefing already covers", async () => {
    // Titles are present, so only the two missing phases run -- which is also
    // what gives them more headroom to finish.
    reply({ avoidTitles: ["Engineering Manager"] });
    reply({ positioning: "Senior product leaders.", whyTheyBuy: ["Roadmap risk"] });

    const b = (await buildPersonaBriefing({
      personaName: "Product",
      icpText: "ICP text",
      existing: PRIOR,
    }))!;

    expect(completeText).toHaveBeenCalledTimes(2);
    // The satisfied phase's content survives untouched.
    expect(b.titles).toEqual(["VP of Product"]);
    expect(b.fallbackTitles).toEqual(["Director of Product"]);
    // And the missing phases are now filled.
    expect(b.avoidTitles).toEqual(["Engineering Manager"]);
    expect(b.positioning).toBe("Senior product leaders.");
  });

  it("clears its own stale failure note once the gap is closed, keeping real findings", async () => {
    reply({ avoidTitles: ["Engineering Manager"] });
    reply({ positioning: "Senior product leaders.", whyTheyBuy: ["Roadmap risk"] });

    const b = (await buildPersonaBriefing({
      personaName: "Product",
      icpText: "ICP text",
      existing: PRIOR,
    }))!;

    expect(b.coverageGaps.join(" ")).not.toMatch(/could not be generated/i);
    // The genuine finding about the documents is not collateral damage.
    expect(b.coverageGaps).toContain("The documents do not define pricing or procurement");
  });

  it("never loses already-good content when the retried phase fails again", async () => {
    // The exact churn this prevents: messaging fails a second time, and the
    // titles that were already stored must still be there afterward.
    reply({ avoidTitles: ["Engineering Manager"] });
    completeText.mockRejectedValueOnce(new Error("completeText timed out after 19000ms"));

    const b = (await buildPersonaBriefing({
      personaName: "Product",
      icpText: "ICP text",
      existing: PRIOR,
    }))!;

    expect(b.titles).toEqual(["VP of Product"]);
    expect(b.avoidTitles).toEqual(["Engineering Manager"]);
    expect(b.coverageGaps.join(" ")).toMatch(/messaging guidance could not be generated/i);
  });

  it("throws as partial, without discarding the stored briefing, when nothing advances", async () => {
    completeText.mockRejectedValueOnce(new Error("completeText timed out after 19000ms"));
    completeText.mockRejectedValueOnce(new Error("completeText timed out after 19000ms"));

    await expect(
      buildPersonaBriefing({ personaName: "Product", icpText: "ICP text", existing: PRIOR }),
    ).rejects.toMatchObject({ partial: true });
    // The caller returns { ok: false } on a throw and leaves the stored
    // briefing untouched, which is the desired outcome here.
  });

  it("regenerates everything when the ICP changed (caller passes no existing)", async () => {
    replyAll(FULL);
    await buildPersonaBriefing({ personaName: "Product", icpText: "ICP text", existing: null });
    expect(completeText).toHaveBeenCalledTimes(3);
  });

  it("does not treat an empty section as already covered", async () => {
    // A failed phase leaves empty lists behind. Counting those as "done"
    // would make the gap permanent -- the phase would never be retried.
    const emptyTitles = { ...PRIOR, titles: [], fallbackTitles: [] };
    replyAll(FULL);
    await buildPersonaBriefing({
      personaName: "Product",
      icpText: "ICP text",
      existing: emptyTitles,
    });
    expect(completeText).toHaveBeenCalledTimes(3);
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
