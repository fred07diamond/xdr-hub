import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { LIST_SORTS, sortLeadLists } from "../app/lib/lead-list-sort.js";

// Reported: the sidebar order looked random (Aug 19, Sep 14, Aug 21, Aug 19,
// Aug 28...) and buried the list just imported. list-lead-lists had no ORDER
// BY at all, so the order was whatever the database returned.

const L = (name: string, createdAt: string | null, totalCount = 0) => ({ name, createdAt, totalCount });

describe("sortLeadLists", () => {
  const lists = [
    L("Aug 19 a", "2026-08-19T10:00:00Z", 0),
    L("Sep 14", "2026-09-14T10:00:00Z", 10),
    L("Aug 21", "2026-08-21T10:00:00Z", 0),
    L("Aug 31", "2026-08-31T10:00:00Z", 79),
  ];

  it("puts the newest first by default", () => {
    expect(sortLeadLists(lists, "newest").map((l) => l.name)).toEqual([
      "Sep 14",
      "Aug 31",
      "Aug 21",
      "Aug 19 a",
    ]);
  });

  it("reverses for oldest", () => {
    expect(sortLeadLists(lists, "oldest")[0].name).toBe("Aug 19 a");
  });

  it("sorts by name case-insensitively", () => {
    const mixed = [L("zebra", "2026-01-01T00:00:00Z"), L("Apple", "2026-01-02T00:00:00Z")];
    expect(sortLeadLists(mixed, "name").map((l) => l.name)).toEqual(["Apple", "zebra"]);
  });

  it("sorts by size, breaking ties by recency", () => {
    // Without the tie-break, a screen full of empty lists would itself be in
    // an arbitrary order -- the original complaint, one level down.
    const sized = [
      L("empty old", "2026-08-01T00:00:00Z", 0),
      L("empty new", "2026-09-01T00:00:00Z", 0),
      L("big", "2026-07-01T00:00:00Z", 50),
    ];
    expect(sortLeadLists(sized, "size").map((l) => l.name)).toEqual(["big", "empty new", "empty old"]);
  });

  it("does not mutate the array it was given", () => {
    // It receives react-query's cached array; sorting in place would reorder
    // the cache itself.
    const input = [...lists];
    const before = input.map((l) => l.name);
    sortLeadLists(input, "oldest");
    expect(input.map((l) => l.name)).toEqual(before);
  });

  it("treats a null or unparseable date as oldest rather than poisoning the sort", () => {
    // A NaN in the comparator leaves the WHOLE array in an arbitrary order,
    // which is the bug being fixed, not a variation of it.
    const messy = [L("null", null), L("junk", "not-a-date"), L("real", "2026-09-01T00:00:00Z")];
    expect(sortLeadLists(messy, "newest")[0].name).toBe("real");
    expect(sortLeadLists(messy, "newest")).toHaveLength(3);
  });

  it("falls back to newest for an unrecognised sort", () => {
    expect(sortLeadLists(lists, "garbage" as never)[0].name).toBe("Sep 14");
  });
});

describe("server-side default order", () => {
  it("list-lead-lists orders newest first", () => {
    // Ordered on the server too, so the FIRST paint is already right instead
    // of settling into place after hydration.
    const SRC = readFileSync(new URL("../actions/list-lead-lists.ts", import.meta.url), "utf8");
    expect(SRC).toContain("orderBy(desc(leadLists.createdAt))");
  });
});

describe("sort options", () => {
  it("offers exactly the four documented choices", () => {
    expect(LIST_SORTS.map((o) => o.value)).toEqual(["newest", "oldest", "name", "size"]);
  });
});
