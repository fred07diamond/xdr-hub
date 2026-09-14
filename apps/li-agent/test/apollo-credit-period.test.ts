import { describe, expect, it } from "vitest";

import {
  billingPeriodContaining,
  clampAnchorDay,
  currentBillingPeriod,
  formatPeriodResetLabel,
  MAX_ANCHOR_DAY,
} from "../server/helpers/apollo-credits/period.js";

const ANCHOR = 4; // this workspace's real Apollo renewal day

function at(iso: string): Date {
  return new Date(iso);
}

describe("billingPeriodContaining", () => {
  it("puts a mid-period instant in the window that already opened", () => {
    const p = billingPeriodContaining(ANCHOR, at("2026-09-20T12:00:00.000Z"));
    expect(p.key).toBe("2026-09-04");
    expect(p.endIso).toBe("2026-10-04T00:00:00.000Z");
  });

  it("steps back a month when the anchor has not arrived yet", () => {
    // Sep 2 is BEFORE Sep 4, so it still belongs to the Aug 4 -> Sep 4 window.
    const p = billingPeriodContaining(ANCHOR, at("2026-09-02T23:59:59.999Z"));
    expect(p.key).toBe("2026-08-04");
    expect(p.endIso).toBe("2026-09-04T00:00:00.000Z");
  });

  it("treats the exact anchor instant as the START of the new period", () => {
    // The boundary case that would double-count if start were exclusive: the
    // instant belongs to the period it opens, never the one it closes.
    const p = billingPeriodContaining(ANCHOR, at("2026-09-04T00:00:00.000Z"));
    expect(p.key).toBe("2026-09-04");
    expect(p.startIso).toBe("2026-09-04T00:00:00.000Z");
  });

  it("treats one millisecond before the anchor as the previous period", () => {
    const p = billingPeriodContaining(ANCHOR, at("2026-09-03T23:59:59.999Z"));
    expect(p.key).toBe("2026-08-04");
  });

  it("rolls the year backward across January", () => {
    const p = billingPeriodContaining(ANCHOR, at("2027-01-02T08:00:00.000Z"));
    expect(p.key).toBe("2026-12-04");
    expect(p.endIso).toBe("2027-01-04T00:00:00.000Z");
  });

  it("rolls the year forward across December", () => {
    const p = billingPeriodContaining(ANCHOR, at("2026-12-31T23:00:00.000Z"));
    expect(p.key).toBe("2026-12-04");
    expect(p.endIso).toBe("2027-01-04T00:00:00.000Z");
  });

  it("spans a short February correctly", () => {
    const p = billingPeriodContaining(ANCHOR, at("2027-02-20T00:00:00.000Z"));
    expect(p.key).toBe("2027-02-04");
    expect(p.endIso).toBe("2027-03-04T00:00:00.000Z");
  });

  it("spans a leap February correctly", () => {
    // 2028 is a leap year; the window still ends on the anchor, not on the
    // month length.
    const p = billingPeriodContaining(ANCHOR, at("2028-02-29T12:00:00.000Z"));
    expect(p.key).toBe("2028-02-04");
    expect(p.endIso).toBe("2028-03-04T00:00:00.000Z");
  });

  it("produces contiguous, non-overlapping windows", () => {
    // Walk a year of anchors: each period's end must be exactly the next
    // period's start, or spend can fall into a gap (uncounted) or an overlap
    // (double-counted).
    let cursor = billingPeriodContaining(ANCHOR, at("2026-01-10T00:00:00.000Z"));
    for (let i = 0; i < 14; i++) {
      const next = billingPeriodContaining(ANCHOR, new Date(cursor.endIso));
      expect(next.startIso).toBe(cursor.endIso);
      expect(next.key).not.toBe(cursor.key);
      cursor = next;
    }
  });

  it("is stable regardless of sub-second clock differences", () => {
    // Two serverless instances computing the period must agree byte-for-byte,
    // since the key is used as a SQL equality match.
    const a = billingPeriodContaining(ANCHOR, at("2026-09-20T12:00:00.001Z"));
    const b = billingPeriodContaining(ANCHOR, at("2026-09-20T12:00:00.999Z"));
    expect(a.key).toBe(b.key);
    expect(a.startIso).toBe(b.startIso);
  });

  it("handles an anchor of 1 (calendar-month equivalent)", () => {
    const p = billingPeriodContaining(1, at("2026-09-20T00:00:00.000Z"));
    expect(p.key).toBe("2026-09-01");
    expect(p.endIso).toBe("2026-10-01T00:00:00.000Z");
  });

  it("handles the maximum anchor of 28 in February without moving the boundary", () => {
    const p = billingPeriodContaining(MAX_ANCHOR_DAY, at("2027-03-01T00:00:00.000Z"));
    expect(p.key).toBe("2027-02-28");
    expect(p.endIso).toBe("2027-03-28T00:00:00.000Z");
  });
});

describe("clampAnchorDay", () => {
  it("rejects days past 28 so the boundary can never silently shift", () => {
    // An anchor of 31 would mean "the 28th" in February and "the 31st"
    // otherwise -- a boundary that moves without the admin asking.
    expect(clampAnchorDay(31)).toBe(28);
    expect(clampAnchorDay(29)).toBe(28);
  });

  it("clamps below range and falls back on garbage", () => {
    expect(clampAnchorDay(0)).toBe(1);
    expect(clampAnchorDay(-5)).toBe(1);
    expect(clampAnchorDay("not a number")).toBe(4);
    expect(clampAnchorDay(null)).toBe(4);
    expect(clampAnchorDay(undefined)).toBe(4);
  });

  it("accepts a string from the settings table", () => {
    // workspace_settings stores every value as text.
    expect(clampAnchorDay("4")).toBe(4);
    expect(clampAnchorDay("12")).toBe(12);
  });

  it("truncates a fractional day", () => {
    expect(clampAnchorDay(4.9)).toBe(4);
  });
});

describe("currentBillingPeriod", () => {
  it("defaults to now and carries the resolved anchor", () => {
    const p = currentBillingPeriod(ANCHOR);
    expect(p.anchorDay).toBe(ANCHOR);
    expect(p.key).toMatch(/^\d{4}-\d{2}-04$/);
    expect(new Date(p.startIso).getTime()).toBeLessThanOrEqual(Date.now());
    expect(new Date(p.endIso).getTime()).toBeGreaterThan(Date.now());
  });
});

describe("formatPeriodResetLabel", () => {
  it("formats the reset date in UTC, matching the enforced window", () => {
    const p = billingPeriodContaining(ANCHOR, at("2026-09-20T12:00:00.000Z"));
    expect(formatPeriodResetLabel(p)).toBe("October 4");
  });

  it("does not drift a day for a viewer behind UTC", () => {
    // A local-time format would render "October 3" for a US viewer, telling
    // them the wrong reset day for a budget enforced in UTC.
    const p = billingPeriodContaining(ANCHOR, at("2026-09-20T12:00:00.000Z"));
    expect(formatPeriodResetLabel(p)).not.toContain("3");
  });
});
