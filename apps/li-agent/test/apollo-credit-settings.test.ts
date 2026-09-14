import { beforeEach, describe, expect, it, vi } from "vitest";

// getApolloCreditSettings' only dependency is one workspace_settings read, so
// the DB is stubbed with a minimal chainable that returns whatever rows the
// test queued. drizzle's `like` is imported by the module under test but never
// evaluated against a real dialect here.
let settingRows: Array<{ key: string; value: string | null }> = [];

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(settingRows),
      }),
    }),
  }),
}));

const {
  APOLLO_CREDIT_DEFAULTS,
  APOLLO_SETTING_KEYS,
  getApolloCreditSettings,
  verdictClearsBar,
} = await import("../server/helpers/apollo-credits/settings.js");

function given(values: Record<string, string | null>) {
  settingRows = Object.entries(values).map(([key, value]) => ({ key, value }));
}

describe("getApolloCreditSettings — fail-closed defaults", () => {
  beforeEach(() => {
    settingRows = [];
  });

  it("is DISABLED when nothing is configured", async () => {
    // The single most important assertion in this file: an empty or wiped
    // settings table must never be the thing that re-enables spend.
    const s = await getApolloCreditSettings();
    expect(s.enabled).toBe(false);
    expect(APOLLO_CREDIT_DEFAULTS.enabled).toBe(false);
  });

  it("is DISABLED when the row exists but is empty or garbage", async () => {
    for (const value of ["", "   ", null, "maybe", "0", "false", "off"]) {
      given({ [APOLLO_SETTING_KEYS.enabled]: value });
      expect((await getApolloCreditSettings()).enabled).toBe(false);
    }
  });

  it("enables only on an explicit affirmative value", async () => {
    for (const value of ["1", "true", "TRUE", " yes ", "on"]) {
      given({ [APOLLO_SETTING_KEYS.enabled]: value });
      expect((await getApolloCreditSettings()).enabled).toBe(true);
    }
  });

  it("falls back to this app's agreed one-third share for the budget", async () => {
    const s = await getApolloCreditSettings();
    expect(s.periodBudget).toBe(27_996);
    expect(s.anchorDay).toBe(4);
    expect(s.userDefaultLimit).toBe(2_000);
    expect(s.phoneStopPct).toBe(80);
    expect(s.sweepReservePct).toBe(50);
  });
});

describe("getApolloCreditSettings — parsing robustness", () => {
  beforeEach(() => {
    settingRows = [];
  });

  it("reads real configured values", async () => {
    given({
      [APOLLO_SETTING_KEYS.periodBudget]: "27996",
      [APOLLO_SETTING_KEYS.anchorDay]: "4",
      [APOLLO_SETTING_KEYS.phoneStopPct]: "75",
      [APOLLO_SETTING_KEYS.userDefaultLimit]: "1500",
    });
    const s = await getApolloCreditSettings();
    expect(s.periodBudget).toBe(27_996);
    expect(s.phoneStopPct).toBe(75);
    expect(s.userDefaultLimit).toBe(1_500);
  });

  it("falls back rather than throwing on a non-numeric budget", async () => {
    // A corrupted value must not take enrichment down, and must not be read
    // as an unlimited budget either.
    given({ [APOLLO_SETTING_KEYS.periodBudget]: "not a number" });
    expect((await getApolloCreditSettings()).periodBudget).toBe(27_996);
  });

  it("refuses a negative budget", async () => {
    given({ [APOLLO_SETTING_KEYS.periodBudget]: "-5000" });
    expect((await getApolloCreditSettings()).periodBudget).toBe(0);
  });

  it("accepts a zero budget as a valid hard stop", async () => {
    // Distinct from "unset": an admin setting 0 is deliberately freezing spend.
    given({ [APOLLO_SETTING_KEYS.periodBudget]: "0" });
    expect((await getApolloCreditSettings()).periodBudget).toBe(0);
  });

  it("clamps the anchor day into a range every month contains", async () => {
    given({ [APOLLO_SETTING_KEYS.anchorDay]: "31" });
    expect((await getApolloCreditSettings()).anchorDay).toBe(28);
    given({ [APOLLO_SETTING_KEYS.anchorDay]: "0" });
    expect((await getApolloCreditSettings()).anchorDay).toBe(1);
  });

  it("never lets the phone-stop percentage be 0", async () => {
    // 0 would block every reveal forever while looking like configuration
    // rather than an outage.
    given({ [APOLLO_SETTING_KEYS.phoneStopPct]: "0" });
    expect((await getApolloCreditSettings()).phoneStopPct).toBe(1);
  });

  it("clamps percentages at 100", async () => {
    given({
      [APOLLO_SETTING_KEYS.phoneStopPct]: "150",
      [APOLLO_SETTING_KEYS.sweepReservePct]: "900",
    });
    const s = await getApolloCreditSettings();
    expect(s.phoneStopPct).toBe(100);
    expect(s.sweepReservePct).toBe(100);
  });

  it("allows a sweep reserve of 0 to turn automatic spend off entirely", async () => {
    given({ [APOLLO_SETTING_KEYS.sweepReservePct]: "0" });
    expect((await getApolloCreditSettings()).sweepReservePct).toBe(0);
  });

  it("parses, sorts and de-dupes thresholds", async () => {
    given({ [APOLLO_SETTING_KEYS.thresholds]: "95, 50 ,80,80,100" });
    expect((await getApolloCreditSettings()).thresholds).toEqual([50, 80, 95, 100]);
  });

  it("drops out-of-range thresholds and falls back when none survive", async () => {
    given({ [APOLLO_SETTING_KEYS.thresholds]: "0,-10,150" });
    expect((await getApolloCreditSettings()).thresholds).toEqual([50, 80, 95, 100]);
    given({ [APOLLO_SETTING_KEYS.thresholds]: "junk" });
    expect((await getApolloCreditSettings()).thresholds).toEqual([50, 80, 95, 100]);
  });

  it("defaults the email bar to not_weak and the phone bar to strong", async () => {
    const s = await getApolloCreditSettings();
    expect(s.enrichMinVerdict).toBe("not_weak");
    expect(s.phoneMinVerdict).toBe("strong");
  });

  it("rejects an unknown verdict bar rather than treating it as 'any'", async () => {
    // Falling through to "any" would silently remove the gate.
    given({ [APOLLO_SETTING_KEYS.enrichMinVerdict]: "whatever" });
    expect((await getApolloCreditSettings()).enrichMinVerdict).toBe("not_weak");
  });

  it("propagates a database error instead of returning defaults", async () => {
    // The caller treats an unreadable store as "deny the spend". Swallowing
    // this and returning defaults would turn a DB outage into an unmetered
    // spending window with enabled:false -- or worse, if the default ever
    // flipped, into unmetered spend.
    settingRows = null as never;
    await expect(getApolloCreditSettings()).rejects.toBeTruthy();
  });
});

describe("verdictClearsBar", () => {
  it("'strong' admits only strong", () => {
    expect(verdictClearsBar("strong", "strong")).toBe(true);
    expect(verdictClearsBar("possible", "strong")).toBe(false);
    expect(verdictClearsBar("weak", "strong")).toBe(false);
    expect(verdictClearsBar("inconclusive", "strong")).toBe(false);
  });

  it("'strong_or_possible' excludes inconclusive", () => {
    expect(verdictClearsBar("strong", "strong_or_possible")).toBe(true);
    expect(verdictClearsBar("possible", "strong_or_possible")).toBe(true);
    expect(verdictClearsBar("weak", "strong_or_possible")).toBe(false);
    expect(verdictClearsBar("inconclusive", "strong_or_possible")).toBe(false);
  });

  it("'not_weak' admits inconclusive — the no-ICP-document case", () => {
    // draftProfile returns `inconclusive` with reason "No ICP document
    // uploaded" when a workspace has no ICP text. If this bar excluded it,
    // such a workspace would silently enrich nothing forever, which is
    // indistinguishable from a broken integration.
    expect(verdictClearsBar("inconclusive", "not_weak")).toBe(true);
    expect(verdictClearsBar("strong", "not_weak")).toBe(true);
    expect(verdictClearsBar("possible", "not_weak")).toBe(true);
    expect(verdictClearsBar("weak", "not_weak")).toBe(false);
  });

  it("'any' admits everything including an unscored lead", () => {
    expect(verdictClearsBar("weak", "any")).toBe(true);
    expect(verdictClearsBar(null, "any")).toBe(true);
  });

  it("treats an unscored lead as NOT clearing a real bar", () => {
    // "we have not looked" is not the same as "we looked and it was fine".
    for (const bar of ["strong", "strong_or_possible", "not_weak"] as const) {
      expect(verdictClearsBar(null, bar)).toBe(false);
      expect(verdictClearsBar(undefined, bar)).toBe(false);
      expect(verdictClearsBar("", bar)).toBe(false);
    }
  });
});
