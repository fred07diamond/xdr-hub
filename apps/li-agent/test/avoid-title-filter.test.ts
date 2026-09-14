import { beforeEach, describe, expect, it, vi } from "vitest";

// The zero-cost prefilter: a lead whose headline matches a persona's
// avoidTitlesSearch entry is provably not worth an Apollo credit, and
// establishing that costs neither an Apollo call nor an LLM call.

let briefingJson: string | null = null;
let selectThrows = false;
let selectCount = 0;

function chain(rows: () => unknown[]) {
  const obj: Record<string, unknown> = {};
  for (const m of ["from", "where", "limit", "orderBy"]) obj[m] = () => obj;
  obj.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
    if (selectThrows) return Promise.reject(new Error("db down")).then(res, rej);
    return Promise.resolve(rows()).then(res, rej);
  };
  return obj;
}

vi.mock("@xdr-hub/shared/server", () => ({
  getSharedDb: () => ({
    select: () => {
      selectCount++;
      return chain(() => (briefingJson === null ? [] : [{ briefing: briefingJson }]));
    },
  }),
  sharedPersonas: { id: "id", briefing: "briefing" },
}));

vi.mock("@agent-native/core/db/schema", () => ({ eq: () => ({}) }));

const { AvoidTitleFilter } = await import("../server/helpers/apollo-credits/avoid-title-filter.js");

beforeEach(() => {
  selectThrows = false;
  selectCount = 0;
  briefingJson = JSON.stringify({
    avoidTitlesSearch: ["Creative Director", "Brand Designer", "ASIC Designer"],
  });
});

describe("AvoidTitleFilter", () => {
  it("matches an excluded title in the headline", async () => {
    const f = new AvoidTitleFilter();
    expect(await f.matchedAvoidTitle("p1", "Creative Director at Acme", null)).toBe("creative director");
  });

  it("matches case-insensitively", async () => {
    const f = new AvoidTitleFilter();
    expect(await f.matchedAvoidTitle("p1", "BRAND DESIGNER | portfolio", null)).toBe("brand designer");
  });

  it("also checks the enriched title", async () => {
    const f = new AvoidTitleFilter();
    expect(await f.matchedAvoidTitle("p1", "Building cool things", "ASIC Designer")).toBe("asic designer");
  });

  it("passes a lead that matches nothing", async () => {
    const f = new AvoidTitleFilter();
    expect(await f.matchedAvoidTitle("p1", "VP of Product", null)).toBeNull();
  });

  it("passes when the lead has no persona to compare against", async () => {
    const f = new AvoidTitleFilter();
    expect(await f.matchedAvoidTitle(null, "Creative Director", null)).toBeNull();
    // No persona means no briefing to read, so it must not even query.
    expect(selectCount).toBe(0);
  });

  it("passes when the headline is empty", async () => {
    const f = new AvoidTitleFilter();
    expect(await f.matchedAvoidTitle("p1", null, null)).toBeNull();
  });

  it("IGNORES short avoid terms that would match almost anything", async () => {
    // A 3-character entry like "eng" would exclude most headlines by accident,
    // and a false exclusion is invisible to the user -- the lead simply never
    // gets enriched with no way to see why.
    briefingJson = JSON.stringify({ avoidTitlesSearch: ["eng", "PM", "Creative Director"] });
    const f = new AvoidTitleFilter();
    expect(await f.matchedAvoidTitle("p1", "Engineering Manager", null)).toBeNull();
    expect(await f.matchedAvoidTitle("p1", "Creative Director", null)).toBe("creative director");
  });

  it("fails OPEN when there is no briefing", async () => {
    // This is an optimisation, never a correctness gate. Failing closed would
    // stop enriching entirely for a persona with no briefing yet.
    briefingJson = null;
    const f = new AvoidTitleFilter();
    expect(await f.matchedAvoidTitle("p1", "Creative Director", null)).toBeNull();
  });

  it("fails OPEN on unparseable briefing JSON", async () => {
    briefingJson = "{not json";
    const f = new AvoidTitleFilter();
    expect(await f.matchedAvoidTitle("p1", "Creative Director", null)).toBeNull();
  });

  it("fails OPEN on a database error", async () => {
    selectThrows = true;
    const f = new AvoidTitleFilter();
    expect(await f.matchedAvoidTitle("p1", "Creative Director", null)).toBeNull();
  });

  it("tolerates a briefing with no avoid list", async () => {
    briefingJson = JSON.stringify({ titles: ["VP Product"] });
    const f = new AvoidTitleFilter();
    expect(await f.matchedAvoidTitle("p1", "Creative Director", null)).toBeNull();
  });

  it("reads each persona's briefing only once per instance", async () => {
    // The sweep checks every lead in a batch; re-reading and re-parsing the
    // same JSON per lead would be wasteful.
    const f = new AvoidTitleFilter();
    await f.matchedAvoidTitle("p1", "VP Product", null);
    await f.matchedAvoidTitle("p1", "Head of Design", null);
    await f.matchedAvoidTitle("p1", "Creative Director", null);
    expect(selectCount).toBe(1);
  });

  it("does not share its cache between instances", async () => {
    // Cache is per-instance (one per sweep tick), not module-level, so a
    // long-lived serverless process can't serve a stale briefing forever.
    const a = new AvoidTitleFilter();
    await a.matchedAvoidTitle("p1", "VP Product", null);
    const b = new AvoidTitleFilter();
    await b.matchedAvoidTitle("p1", "VP Product", null);
    expect(selectCount).toBe(2);
  });
});
