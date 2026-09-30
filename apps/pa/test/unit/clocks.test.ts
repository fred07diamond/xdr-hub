import { describe, expect, it } from "vitest";

import {
  addWorkingMinutes,
  isWithinWorkingHours,
  nextWorkingInstant,
  planClocks,
  readFirstTouchClock,
  wallTimeToInstant,
  workingMinutesBetween,
  type WorkingHours,
} from "../../server/core/clocks/index.js";

const PT: WorkingHours = {
  timezone: "America/Los_Angeles",
  days: [1, 2, 3, 4, 5],
  start: "09:00",
  end: "17:00",
};

const at = (iso: string) => new Date(iso);

describe("wallTimeToInstant", () => {
  it("maps Pacific wall time to UTC in daylight and standard time", () => {
    expect(
      wallTimeToInstant(2026, 9, 29, 10, 0, PT.timezone).toISOString(),
    ).toBe("2026-09-29T17:00:00.000Z");
    expect(
      wallTimeToInstant(2026, 11, 2, 9, 30, PT.timezone).toISOString(),
    ).toBe("2026-11-02T17:30:00.000Z");
  });
});

describe("addWorkingMinutes", () => {
  it("adds inside one working day", () => {
    expect(
      addWorkingMinutes(at("2026-09-29T17:00:00Z"), 60, PT).toISOString(),
    ).toBe("2026-09-29T18:00:00.000Z");
  });

  it("carries over the end of the day into the next morning", () => {
    // Tue 16:30 PT + 60 working minutes = Wed 09:30 PT
    expect(
      addWorkingMinutes(at("2026-09-29T23:30:00Z"), 60, PT).toISOString(),
    ).toBe("2026-09-30T16:30:00.000Z");
  });

  it("skips the weekend", () => {
    // Fri 16:30 PT + 60 = Mon 09:30 PT
    expect(
      addWorkingMinutes(at("2026-10-02T23:30:00Z"), 60, PT).toISOString(),
    ).toBe("2026-10-05T16:30:00.000Z");
  });

  it("starts at the next working hour when submitted outside hours", () => {
    // Sat noon PT + 60 = Mon 10:00 PT; Tue 07:00 PT + 60 = Tue 10:00 PT
    expect(
      addWorkingMinutes(at("2026-10-03T19:00:00Z"), 60, PT).toISOString(),
    ).toBe("2026-10-05T17:00:00.000Z");
    expect(
      addWorkingMinutes(at("2026-09-29T14:00:00Z"), 60, PT).toISOString(),
    ).toBe("2026-09-29T17:00:00.000Z");
  });

  it("stays correct across the end of daylight saving time", () => {
    // Fri Oct 30 16:30 PDT + 60 = Mon Nov 2 09:30 PST (17:30Z)
    expect(
      addWorkingMinutes(at("2026-10-30T23:30:00Z"), 60, PT).toISOString(),
    ).toBe("2026-11-02T17:30:00.000Z");
  });

  it("handles a timezone east of UTC", () => {
    const london: WorkingHours = {
      ...PT,
      timezone: "Europe/London",
      end: "17:30",
    };
    // Tue 17:00 BST (16:00Z) + 60: 30 min today, 30 min Wed from 09:00 BST
    expect(
      addWorkingMinutes(at("2026-09-29T16:00:00Z"), 60, london).toISOString(),
    ).toBe("2026-09-30T08:30:00.000Z");
  });
});

describe("workingMinutesBetween and window checks", () => {
  it("counts only minutes inside working hours", () => {
    expect(
      workingMinutesBetween(
        at("2026-09-29T23:30:00Z"),
        at("2026-09-30T16:30:00Z"),
        PT,
      ),
    ).toBe(60);
    expect(
      workingMinutesBetween(
        at("2026-10-03T16:00:00Z"),
        at("2026-10-04T23:00:00Z"),
        PT,
      ),
    ).toBe(0);
  });

  it("knows when a moment is inside working hours", () => {
    expect(isWithinWorkingHours(at("2026-09-29T17:00:00Z"), PT)).toBe(true);
    expect(isWithinWorkingHours(at("2026-09-30T02:00:00Z"), PT)).toBe(false);
    expect(
      nextWorkingInstant(at("2026-09-30T02:00:00Z"), PT).toISOString(),
    ).toBe("2026-09-30T16:00:00.000Z");
  });
});

describe("planClocks", () => {
  const base = {
    ownerHours: PT,
    submittedAt: at("2026-09-29T17:00:00Z"),
    firstTouchMinutes: 60,
    decisionHours: 24,
  };

  it("gives a routed lead a first-touch clock and a 24 hour decision clock", () => {
    const plan = planClocks({
      ...base,
      hasHumanOwner: true,
      state: "awaiting_first_touch",
      relationshipState: "new",
    });
    expect(plan.firstTouch.dueAt).toBe("2026-09-29T18:00:00.000Z");
    expect(plan.decision.dueAt).toBe("2026-09-30T17:00:00.000Z");
    expect(plan.decision.basis).toBe("calendar_hours");
  });

  it("skips the decision clock for an already SAL lead", () => {
    const plan = planClocks({
      ...base,
      hasHumanOwner: true,
      state: "attached",
      relationshipState: "owned",
    });
    expect(plan.firstTouch.applies).toBe(true);
    expect(plan.decision.applies).toBe(false);
    expect(plan.decision.reason).toMatch(/Already SAL/);
  });

  it("applies no clock without a human owner", () => {
    const plan = planClocks({
      ...base,
      hasHumanOwner: false,
      ownerHours: null,
      state: "closed",
      relationshipState: "customer",
      settledReason: "No clock: routed to support",
    });
    expect(plan.firstTouch.applies).toBe(false);
    expect(plan.firstTouch.reason).toBe("No clock: routed to support");
  });
});

describe("readFirstTouchClock", () => {
  const clock = {
    dueAt: "2026-09-29T18:00:00.000Z",
    startsAt: "2026-09-29T17:00:00.000Z",
    firstTouchAt: null,
    hours: PT,
    totalMinutes: 60,
    reminderFraction: 0.75,
  };

  it("moves from running to at risk to breached", () => {
    expect(
      readFirstTouchClock({ ...clock, now: at("2026-09-29T17:20:00Z") }).status,
    ).toBe("running");
    expect(
      readFirstTouchClock({ ...clock, now: at("2026-09-29T17:46:00Z") }).status,
    ).toBe("at_risk");
    expect(
      readFirstTouchClock({ ...clock, now: at("2026-09-29T18:01:00Z") }).status,
    ).toBe("breached");
  });

  it("reports not started before the owner's hours and met after a first touch", () => {
    expect(
      readFirstTouchClock({
        ...clock,
        startsAt: "2026-09-30T16:00:00.000Z",
        now: at("2026-09-30T03:00:00Z"),
      }).status,
    ).toBe("not_started");
    expect(
      readFirstTouchClock({
        ...clock,
        firstTouchAt: "2026-09-29T17:10:00Z",
        now: at("2026-09-29T19:00:00Z"),
      }).status,
    ).toBe("met");
  });
});
