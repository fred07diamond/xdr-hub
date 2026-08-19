// Converts a wall-clock date+time in an arbitrary IANA timezone to the
// actual UTC instant, using only built-in Intl/Date (no date-fns-tz/luxon
// dependency). Correctly handles DST since it reads the zone's real offset
// on the given date rather than a fixed offset table.
//
// dateStr: "YYYY-MM-DD", timeStr: "HH:mm", timeZone: e.g. "America/New_York"
export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const asIfUtc = new Date(`${dateStr}T${timeStr}:00Z`);
  const inZone = new Date(asIfUtc.toLocaleString("en-US", { timeZone }));
  const inUtc = new Date(asIfUtc.toLocaleString("en-US", { timeZone: "UTC" }));
  const offsetMs = inUtc.getTime() - inZone.getTime();
  return new Date(asIfUtc.getTime() + offsetMs);
}
