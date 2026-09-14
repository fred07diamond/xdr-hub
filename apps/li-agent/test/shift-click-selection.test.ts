import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { applyShiftClickSelection } from "../app/lib/selection.js";

// Reported: shift-click range select "only looks to be working on prospects".
// It was: Prospects and the Lead Lists ITEMS table had it; the Engagement
// table and the Lead Lists SIDEBAR did not. The gesture either works
// everywhere or it reads as broken, so these tests pin every surface.

function src(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const CHECKBOX_SURFACES = [
  "app/routes/_index.tsx",
  "app/routes/lead-lists.tsx",
  "app/routes/engagement.tsx",
];

describe("shift-click is wired on every selectable table", () => {
  it.each(CHECKBOX_SURFACES)("%s uses the shared helper", (path) => {
    expect(src(path)).toContain("applyShiftClickSelection");
  });

  it.each(CHECKBOX_SURFACES)("%s reads shiftKey from onClick, not onChange", (path) => {
    // React's onChange event for a checkbox carries no shiftKey, so a handler
    // wired to onChange can never detect the modifier -- the exact reason this
    // silently did nothing on two of the three tables.
    // Any param name -- the three files use `e`, `ev` and `ev`.
    expect(src(path)).toMatch(/onClick=\{\(\w+\)\s*=>[^}]*\.shiftKey/);
  });

  it("covers the lists sidebar as well as the items table", () => {
    // Two independent selections live in lead-lists.tsx: leads within a list,
    // and the lists themselves. Both need it.
    const SRC = src("app/routes/lead-lists.tsx");
    expect(SRC).toContain("lastCheckedItemIdRef");
    expect(SRC).toContain("lastCheckedListIdRef");
  });
});

describe("applyShiftClickSelection", () => {
  const rows = ["a", "b", "c", "d", "e"].map((id) => ({ id }));

  it("toggles a single row with no shift", () => {
    expect([...applyShiftClickSelection(rows, 2, false, null, new Set())]).toEqual(["c"]);
    expect([...applyShiftClickSelection(rows, 2, false, null, new Set(["c"]))]).toEqual([]);
  });

  it("selects the inclusive range from the anchor", () => {
    const out = applyShiftClickSelection(rows, 3, true, "b", new Set(["b"]));
    expect([...out].sort()).toEqual(["b", "c", "d"]);
  });

  it("works when the range is dragged upward", () => {
    const out = applyShiftClickSelection(rows, 1, true, "d", new Set(["d"]));
    expect([...out].sort()).toEqual(["b", "c", "d"]);
  });

  it("never REMOVES rows in a shift range", () => {
    // Additive on purpose: shift-click extends a selection. Toggling within
    // the range would make a second shift-click undo the first, which is not
    // how Gmail or Finder behave.
    const out = applyShiftClickSelection(rows, 3, true, "b", new Set(["b", "c", "z"]));
    expect(out.has("z")).toBe(true);
    expect(out.has("c")).toBe(true);
  });

  it("falls back to a single toggle when the anchor has gone", () => {
    // These lists refetch on a poll, so the anchor row can genuinely vanish
    // mid-interaction. Resolving by id each time means a stale anchor degrades
    // to a normal click instead of selecting a wrong range.
    const out = applyShiftClickSelection(rows, 2, true, "gone", new Set());
    expect([...out]).toEqual(["c"]);
  });

  it("is a no-op for an out-of-range index", () => {
    const before = new Set(["a"]);
    expect(applyShiftClickSelection(rows, 99, false, null, before)).toBe(before);
  });

  it("does not mutate the set it was given", () => {
    const before = new Set(["a"]);
    applyShiftClickSelection(rows, 2, false, null, before);
    expect([...before]).toEqual(["a"]);
  });
});
