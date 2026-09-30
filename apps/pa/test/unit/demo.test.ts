import { describe, expect, it } from "vitest";

import { buildDemoData, demoAnchor } from "../../server/core/demo/index.js";
import { isDemoId } from "../../shared/demo.js";

// Tuesday 2026-09-29, 3:05 PM Pacific.
const TUESDAY_AFTERNOON = new Date("2026-09-29T22:05:00.000Z");

describe("demo anchor", () => {
  it("uses today's 11:30 AM Pacific once it has passed", () => {
    expect(demoAnchor(TUESDAY_AFTERNOON).toISOString()).toBe(
      "2026-09-29T18:30:00.000Z",
    );
  });

  it("uses the previous weekday before 11:30 AM and on weekends", () => {
    expect(demoAnchor(new Date("2026-09-29T15:00:00.000Z")).toISOString()).toBe(
      "2026-09-28T18:30:00.000Z",
    );
    // Sunday 2026-10-04 and Monday 2026-10-05 at 8 AM Pacific both fall back to Friday.
    expect(demoAnchor(new Date("2026-10-04T20:00:00.000Z")).toISOString()).toBe(
      "2026-10-02T18:30:00.000Z",
    );
    expect(demoAnchor(new Date("2026-10-05T15:00:00.000Z")).toISOString()).toBe(
      "2026-10-02T18:30:00.000Z",
    );
  });

  it("follows daylight saving time in winter", () => {
    expect(demoAnchor(new Date("2026-12-08T22:00:00.000Z")).toISOString()).toBe(
      "2026-12-08T19:30:00.000Z",
    );
  });
});

describe("demo dataset", () => {
  it("runs every made-up lead through the pipeline and fills each board tab", async () => {
    const demo = await buildDemoData({ now: TUESDAY_AFTERNOON });
    expect(demo.failures).toEqual([]);

    const team = await demo.board("team", null);
    expect(team.total).toBe(demo.leadCount);
    expect(team.rows).toHaveLength(demo.leadCount);
    expect(team.rows.every((row) => isDemoId(row.id))).toBe(true);
    expect(team.counts.mine).toBeGreaterThan(0);
    expect(team.counts.at_risk).toBeGreaterThan(0);
    expect(team.counts.breached).toBeGreaterThan(0);

    const statuses = new Set(team.rows.map((row) => row.clock.status));
    for (const status of [
      "breached",
      "at_risk",
      "running",
      "not_started",
      "none",
    ]) {
      expect(statuses).toContain(status);
    }
    const states = new Set(team.rows.map((row) => row.state));
    for (const state of [
      "awaiting_first_touch",
      "attached",
      "closed",
      "disqualified",
    ]) {
      expect(states).toContain(state);
    }
    expect(team.rows.filter((row) => row.flagged)).toHaveLength(1);
  });

  it("opens records and receipts for demo ids, and keeps ids stable across builds", async () => {
    const first = await buildDemoData({ now: TUESDAY_AFTERNOON });
    const second = await buildDemoData({ now: TUESDAY_AFTERNOON });
    const firstIds = (await first.board("team", null)).rows.map(
      (row) => row.id,
    );
    expect(
      (await second.board("team", null)).rows.map((row) => row.id),
    ).toEqual(firstIds);

    const detail = await first.engagement(firstIds[0]);
    expect(detail).not.toBeNull();
    expect(detail?.receipts.length).toBeGreaterThan(0);
    const receipt = await first.receipt(detail!.receipts[0].id);
    expect(receipt?.id).toBe(detail!.receipts[0].id);
    expect(await first.engagement("demo-999999")).toBeNull();
  });
});
