import { defineAction } from "@agent-native/core";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { bookedMeetings, generatedNotes } from "../server/db/schema.js";
import { bookCalendarEvent } from "../server/helpers/book-calendar-event.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "Create (or retry creating) the Google Calendar event for a confirmed meeting whose calendar booking previously failed. Books on the XDR's connected Google Calendar with the AE and prospect as attendees.",
  schema: z.object({
    meetingId: z.string().min(1),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ meetingId }, ctx) => {
    const role = await requireRole(ctx?.userEmail, ["xdr", "admin"]);
    const db = getDb();

    const [meeting] = await db
      .select()
      .from(bookedMeetings)
      .where(eq(bookedMeetings.id, meetingId))
      .limit(1);
    if (!meeting) {
      throw Object.assign(new Error("Meeting not found"), { statusCode: 404 });
    }
    if (role !== "admin" && meeting.xdrUserEmail !== ctx!.userEmail) {
      throw Object.assign(
        new Error("Access denied — this meeting belongs to another XDR"),
        { statusCode: 403 },
      );
    }
    if (meeting.calendarEventId) {
      return {
        meetingId,
        calendarEventId: meeting.calendarEventId,
        meetingLink: meeting.meetingLink,
        alreadyBooked: true,
      };
    }
    if (!meeting.meetingDatetime) {
      throw Object.assign(
        new Error("Meeting has no date/time — set one first via update-meeting."),
        { statusCode: 400 },
      );
    }

    const [notes] = await db
      .select({ meetingAgenda: generatedNotes.meetingAgenda })
      .from(generatedNotes)
      .where(eq(generatedNotes.meetingId, meetingId))
      .limit(1);

    let result: { eventId: string; meetingLink: string };
    try {
      result = await bookCalendarEvent({
        title: `Builder.io Discovery — ${meeting.prospectName} (${meeting.company})`,
        datetime: meeting.meetingDatetime,
        prospectEmail: meeting.prospectEmail ?? undefined,
        aeEmail: meeting.aeUserEmail,
        xdrEmail: meeting.xdrUserEmail,
        description: notes?.meetingAgenda ?? "",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw Object.assign(new Error(msg), { statusCode: 502 });
    }

    await db
      .update(bookedMeetings)
      .set({
        calendarEventId: result.eventId,
        meetingLink: result.meetingLink,
      })
      .where(and(eq(bookedMeetings.id, meetingId), eq(bookedMeetings.status, "confirmed")));

    return {
      meetingId,
      calendarEventId: result.eventId,
      meetingLink: result.meetingLink,
      alreadyBooked: false,
    };
  },
});
