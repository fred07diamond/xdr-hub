// The inbound board puts the newest request on top by default, keeps the
// SLA order on "Most urgent", and narrows by when the lead was submitted.
import type { BoardRow } from "@shared/pa-views";
import { describe, expect, it } from "vitest";

import {
  arrangeRows,
  boardQuery,
  isNewLead,
  parseSort,
  parseWindow,
} from "../../app/lib/board-arrange.js";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const row = (id: string, hoursAgo: number) =>
  ({
    id,
    submittedAt: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
  }) as BoardRow;

// The server's order: most urgent first, so the newest lead is last.
const urgent = [row("breached", 50), row("at-risk", 30), row("fresh", 0.2)];

describe("arrangeRows", () => {
  it("floats the newest request to the top by default", () => {
    expect(parseSort(null)).toBe("newest");
    const ids = arrangeRows(urgent, {
      sort: "newest",
      within: "all",
      now: NOW,
    });
    expect(ids.map((item) => item.id)).toEqual([
      "fresh",
      "at-risk",
      "breached",
    ]);
  });

  it("keeps the SLA order on Most urgent", () => {
    const ids = arrangeRows(urgent, {
      sort: "urgent",
      within: "all",
      now: NOW,
    });
    expect(ids.map((item) => item.id)).toEqual([
      "breached",
      "at-risk",
      "fresh",
    ]);
  });

  it("narrows to a submission window", () => {
    const ids = arrangeRows(urgent, {
      sort: "newest",
      within: "24h",
      now: NOW,
    });
    expect(ids.map((item) => item.id)).toEqual(["fresh"]);
    expect(parseWindow("nonsense")).toBe("all");
  });

  it("marks a lead from the last hour as new, and keeps the view in links", () => {
    expect(isNewLead(urgent[2], NOW)).toBe(true);
    expect(isNewLead(urgent[1], NOW)).toBe(false);
    expect(boardQuery({ tab: "team", sort: "newest", within: "all" })).toBe(
      "tab=team",
    );
    expect(boardQuery({ tab: "mine", sort: "urgent", within: "7d" })).toBe(
      "tab=mine&sort=urgent&within=7d",
    );
  });
});
