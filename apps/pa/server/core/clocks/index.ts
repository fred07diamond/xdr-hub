// Timezone math uses Intl.DateTimeFormat (ECMA-402), available in Node and edge runtimes:
// https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat

export interface WorkingHours {
  timezone: string;
  /** ISO weekdays: 1 = Monday, 7 = Sunday. */
  days: number[];
  start: string;
  end: string;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  isoWeekday: number;
}

const WEEKDAYS: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string) {
  let existing = formatters.get(timezone);
  if (!existing) {
    existing = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(timezone, existing);
  }
  return existing;
}

export function zonedParts(date: Date, timezone: string): ZonedParts {
  const values: Record<string, string> = {};
  for (const part of formatter(timezone).formatToParts(date)) {
    values[part.type] = part.value;
  }
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour) % 24,
    minute: Number(values.minute),
    second: Number(values.second),
    isoWeekday: WEEKDAYS[values.weekday] ?? 0,
  };
}

function offsetMs(date: Date, timezone: string): number {
  const p = zonedParts(date, timezone);
  const wallAsUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  const whole = date.getTime() - date.getUTCMilliseconds();
  return wallAsUtc - whole;
}

/** The instant when the wall clock in `timezone` reads the given time. */
export function wallTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetMs(new Date(guess), timezone);
  const second = guess - offsetMs(new Date(first), timezone);
  return new Date(second);
}

function parseHm(value: string): [number, number] {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match)
    throw new Error(`Working hours must look like 09:00, got ${value}`);
  return [Number(match[1]), Number(match[2])];
}

interface DayWindow {
  start: Date;
  end: Date;
  working: boolean;
  nextDay: Date;
}

function windowFor(cursor: Date, hours: WorkingHours): DayWindow {
  const p = zonedParts(cursor, hours.timezone);
  const [sh, sm] = parseHm(hours.start);
  const [eh, em] = parseHm(hours.end);
  return {
    start: wallTimeToInstant(p.year, p.month, p.day, sh, sm, hours.timezone),
    end: wallTimeToInstant(p.year, p.month, p.day, eh, em, hours.timezone),
    working: hours.days.includes(p.isoWeekday),
    nextDay: wallTimeToInstant(
      p.year,
      p.month,
      p.day + 1,
      0,
      0,
      hours.timezone,
    ),
  };
}

const MINUTE = 60_000;
const MAX_DAYS = 400;

export function nextWorkingInstant(from: Date, hours: WorkingHours): Date {
  let cursor = from;
  for (let guard = 0; guard < MAX_DAYS; guard += 1) {
    const day = windowFor(cursor, hours);
    if (day.working && cursor < day.end) {
      return cursor < day.start ? day.start : cursor;
    }
    cursor = day.nextDay;
  }
  throw new Error("Working hours never open; check the schedule");
}

export function addWorkingMinutes(
  from: Date,
  minutes: number,
  hours: WorkingHours,
): Date {
  let remaining = minutes;
  let cursor = nextWorkingInstant(from, hours);
  for (let guard = 0; guard < MAX_DAYS; guard += 1) {
    const day = windowFor(cursor, hours);
    const available = (day.end.getTime() - cursor.getTime()) / MINUTE;
    if (remaining <= available) {
      return new Date(cursor.getTime() + remaining * MINUTE);
    }
    remaining -= available;
    cursor = nextWorkingInstant(day.nextDay, hours);
  }
  throw new Error("Clock did not resolve within a year of working days");
}

export function workingMinutesBetween(
  from: Date,
  to: Date,
  hours: WorkingHours,
): number {
  if (to <= from) return 0;
  let total = 0;
  let cursor = from;
  for (let guard = 0; guard < MAX_DAYS && cursor < to; guard += 1) {
    const day = windowFor(cursor, hours);
    if (day.working) {
      const start = Math.max(cursor.getTime(), day.start.getTime());
      const end = Math.min(to.getTime(), day.end.getTime());
      if (end > start) total += (end - start) / MINUTE;
    }
    cursor = day.nextDay;
  }
  return Math.round(total * 100) / 100;
}

export function isWithinWorkingHours(at: Date, hours: WorkingHours): boolean {
  return nextWorkingInstant(at, hours).getTime() === at.getTime();
}

export type ClockKind = "first_touch" | "decision";

export interface ClockPlan {
  kind: ClockKind;
  applies: boolean;
  startsAt: string | null;
  dueAt: string | null;
  basis: "owner_working_hours" | "calendar_hours" | null;
  reason: string;
}

export function planClocks(input: {
  hasHumanOwner: boolean;
  ownerHours: WorkingHours | null;
  submittedAt: Date;
  state: string;
  relationshipState: string | null;
  firstTouchMinutes: number;
  decisionHours: number;
  settledReason?: string;
}): { firstTouch: ClockPlan; decision: ClockPlan } {
  const none = (kind: ClockKind, reason: string): ClockPlan => ({
    kind,
    applies: false,
    startsAt: null,
    dueAt: null,
    basis: null,
    reason,
  });
  if (!input.hasHumanOwner || !input.ownerHours) {
    const reason = input.settledReason ?? "No human owner";
    return {
      firstTouch: none("first_touch", reason),
      decision: none("decision", reason),
    };
  }
  const clocked =
    input.state === "awaiting_first_touch" || input.state === "attached";
  if (!clocked) {
    const reason = input.settledReason ?? `No clock in state ${input.state}`;
    return {
      firstTouch: none("first_touch", reason),
      decision: none("decision", reason),
    };
  }
  const startsAt = nextWorkingInstant(input.submittedAt, input.ownerHours);
  const firstTouch: ClockPlan = {
    kind: "first_touch",
    applies: true,
    startsAt: startsAt.toISOString(),
    dueAt: addWorkingMinutes(
      input.submittedAt,
      input.firstTouchMinutes,
      input.ownerHours,
    ).toISOString(),
    basis: "owner_working_hours",
    reason: `${input.firstTouchMinutes} working minutes in the owner's hours`,
  };
  const alreadyDecided =
    input.relationshipState === "owned" ||
    input.relationshipState === "open_deal";
  const decision: ClockPlan = alreadyDecided
    ? none(
        "decision",
        input.relationshipState === "owned"
          ? "Already SAL; no QL to SAL decision pending"
          : "Open deal in progress; no QL to SAL decision pending",
      )
    : {
        kind: "decision",
        applies: true,
        startsAt: input.submittedAt.toISOString(),
        dueAt: new Date(
          input.submittedAt.getTime() + input.decisionHours * 60 * MINUTE,
        ).toISOString(),
        basis: "calendar_hours",
        reason: `${input.decisionHours} hours from submission (rule.sla.decision has no clock basis)`,
      };
  return { firstTouch, decision };
}

export type ClockStatus =
  | "none"
  | "not_started"
  | "running"
  | "at_risk"
  | "breached"
  | "met";

export interface ClockReading {
  status: ClockStatus;
  totalMinutes: number | null;
  elapsedMinutes: number | null;
  remainingMinutes: number | null;
  fraction: number | null;
}

export function readFirstTouchClock(input: {
  dueAt: string | null;
  startsAt: string | null;
  firstTouchAt: string | null;
  now: Date;
  hours: WorkingHours | null;
  totalMinutes: number;
  reminderFraction: number;
}): ClockReading {
  const empty = {
    totalMinutes: null,
    elapsedMinutes: null,
    remainingMinutes: null,
    fraction: null,
  };
  if (!input.dueAt || !input.hours) return { status: "none", ...empty };
  if (input.firstTouchAt) return { status: "met", ...empty };
  const due = new Date(input.dueAt);
  const starts = input.startsAt ? new Date(input.startsAt) : null;
  if (starts && input.now < starts) {
    return {
      status: "not_started",
      totalMinutes: input.totalMinutes,
      elapsedMinutes: 0,
      remainingMinutes: input.totalMinutes,
      fraction: 0,
    };
  }
  const origin = starts ?? due;
  const elapsed = Math.min(
    input.totalMinutes,
    workingMinutesBetween(origin, input.now, input.hours),
  );
  const fraction = elapsed / input.totalMinutes;
  const remaining = Math.max(0, input.totalMinutes - elapsed);
  const status: ClockStatus =
    input.now > due
      ? "breached"
      : fraction >= input.reminderFraction
        ? "at_risk"
        : "running";
  return {
    status,
    totalMinutes: input.totalMinutes,
    elapsedMinutes: Math.round(elapsed),
    remainingMinutes: Math.round(remaining),
    fraction: Math.min(1, fraction),
  };
}
