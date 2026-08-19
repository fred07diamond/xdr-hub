import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { fetchCalendarEvents } from "../server/helpers/google-calendar-events.js";
import { MEETING_DURATION_MIN } from "../server/helpers/meeting-constants.js";
import { requireRole } from "../server/helpers/require-role.js";
import { resolveOwner } from "../server/helpers/resolve-owner.js";
import { zonedTimeToUtc } from "../server/helpers/timezone.js";

const BUSINESS_START_HOUR = 9;
const BUSINESS_END_HOUR = 17;
const SLOT_GRANULARITY_MIN = 30;

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default defineAction({
  description:
    "Compute available meeting time slots for an AE on a given day, within business hours in the given timezone, excluding their existing calendar events. Requires the AE's calendar to be viewable by the calling xDR's Google account.",
  schema: z.object({
    aeEmail: z.string().email(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
    timezone: z.string().min(1),
    apiToken: z.string().nullish(),
  }),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: true, requiresAuth: false },
  http: { method: "GET" },
  run: async ({ aeEmail, date, timezone, apiToken }, ctx) => {
    const ownerEmail = await resolveOwner(apiToken, ctx);
    await requireRole(ownerEmail ?? undefined, ["xdr", "ae", "admin"]);

    // Widen the fetch window by a day on each side -- business hours in a
    // far-from-UTC timezone can span into an adjacent UTC calendar day.
    const { events, connected, reason } = await fetchCalendarEvents({
      ownerEmail: ownerEmail!,
      from: addDays(date, -1),
      to: addDays(date, 1),
      calendarEmail: aeEmail,
    });

    if (!connected) {
      return { slots: [] as string[], connected: false, reason };
    }

    const busy = events
      .filter((e) => !e.allDay)
      .map((e) => ({ start: new Date(e.start).getTime(), end: new Date(e.end).getTime() }));

    const dayStart = zonedTimeToUtc(date, `${String(BUSINESS_START_HOUR).padStart(2, "0")}:00`, timezone);
    const dayEnd = zonedTimeToUtc(date, `${String(BUSINESS_END_HOUR).padStart(2, "0")}:00`, timezone);

    const slots: string[] = [];
    for (
      let slotStart = dayStart.getTime();
      slotStart + MEETING_DURATION_MIN * 60_000 <= dayEnd.getTime();
      slotStart += SLOT_GRANULARITY_MIN * 60_000
    ) {
      const slotEnd = slotStart + MEETING_DURATION_MIN * 60_000;
      const overlaps = busy.some((b) => slotStart < b.end && slotEnd > b.start);
      if (!overlaps) slots.push(new Date(slotStart).toISOString());
    }

    return { slots, connected: true, reason: null };
  },
});
