import { beforeAll, describe, expect, it } from "vitest";

import { localDatetimeValueToISO, toLocalDatetimeValue } from "../app/lib/utils";

beforeAll(() => {
  // Fix the runtime's local timezone so the test is deterministic regardless
  // of where it runs.
  // guard:allow-env-credential — test-only timezone override, not a credential
  process.env.TZ = "America/New_York";
});

describe("toLocalDatetimeValue", () => {
  it("returns empty string for null/undefined", () => {
    expect(toLocalDatetimeValue(null)).toBe("");
    expect(toLocalDatetimeValue(undefined)).toBe("");
  });

  it("returns empty string for an invalid iso string", () => {
    expect(toLocalDatetimeValue("not-a-date")).toBe("");
  });

  it("converts a UTC instant to the runtime's local wall-clock time", () => {
    // 2026-08-05T14:00:00Z is 10:00 in America/New_York (EDT, UTC-4).
    const iso = "2026-08-05T14:00:00.000Z";
    expect(toLocalDatetimeValue(iso)).toBe("2026-08-05T10:00");
    // The old buggy behavior (`iso.slice(0, 16)`) would have produced this
    // instead — assert we no longer match it.
    expect(toLocalDatetimeValue(iso)).not.toBe(iso.slice(0, 16));
  });
});

describe("localDatetimeValueToISO", () => {
  it("returns null for an empty value", () => {
    expect(localDatetimeValueToISO("")).toBeNull();
  });

  it("converts a local wall-clock value back to the correct UTC instant", () => {
    expect(localDatetimeValueToISO("2026-08-05T10:00")).toBe("2026-08-05T14:00:00.000Z");
  });

  it("round-trips through toLocalDatetimeValue", () => {
    const local = "2026-08-05T10:00";
    const iso = localDatetimeValueToISO(local);
    expect(toLocalDatetimeValue(iso)).toBe(local);
  });
});
