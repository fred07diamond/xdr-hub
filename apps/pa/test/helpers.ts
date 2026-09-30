import { createUlidFactory } from "../server/core/ids.js";
import { seedRelease } from "../server/core/playbook/release.js";
import type { PlaybookRelease } from "../server/core/playbook/schema.js";

/** Tuesday 2026-09-29 10:00 in Los Angeles, 13:00 in New York. */
export const TUESDAY_MORNING_PT = new Date("2026-09-29T17:00:00.000Z");

export function fixedClock(start: Date = TUESDAY_MORNING_PT) {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    advance(ms: number) {
      current += ms;
    },
    set(date: Date) {
      current = date.getTime();
    },
  };
}

export function idFactory(clock: { now: () => Date }) {
  const next = createUlidFactory();
  return () => next(clock.now().getTime());
}

export function releaseWith(
  entryId: string,
  params: Record<string, unknown>,
  base: PlaybookRelease = seedRelease,
): PlaybookRelease {
  const clone = structuredClone(base);
  const entry = clone.entries.find((item) => item.id === entryId);
  if (!entry) throw new Error(`No entry ${entryId}`);
  entry.params = { ...(entry.params ?? {}), ...params };
  return clone;
}
