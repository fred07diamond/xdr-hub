import { and, eq, isNull } from "drizzle-orm";
import type { getDb } from "../db/index.js";
import { bookedMeetings } from "../db/schema.js";
import { bookCalendarEvent } from "./book-calendar-event.js";
import { createZoomMeeting } from "./create-zoom-meeting.js";
import { MEETING_DURATION_MIN } from "./meeting-constants.js";

interface MeetingRow {
  id: string;
  prospectName: string;
  company: string;
  prospectEmail: string | null;
  aeUserEmail: string;
  xdrUserEmail: string;
  meetingDatetime: string | null;
  meetingLink: string | null;
  calendarEventId: string | null;
}

// Shared by book-meeting-calendar.ts (the web app's "Save" button, once a
// meeting is confirmed) and capture-nooks-transcript.ts (the extension's
// Send button, when the rep already picked an AE + time before sending) --
// creates/moves the actual Google Calendar event for a meeting and writes
// calendarEventId/meetingLink back with a race guard so two concurrent
// booking attempts can't produce two calendar events for the same meeting.
export async function bookMeetingOnCalendar({
  db,
  meeting,
  meetingAgenda,
  generateZoom,
}: {
  db: ReturnType<typeof getDb>;
  meeting: MeetingRow;
  meetingAgenda: string;
  generateZoom?: boolean;
}): Promise<{
  calendarEventId: string;
  meetingLink: string;
  calendarOwner: string;
  warnings: string[];
}> {
  if (!meeting.meetingDatetime) {
    throw Object.assign(new Error("Meeting has no date/time to book."), { statusCode: 400 });
  }

  const title = `Builder.io Discovery — ${meeting.prospectName} (${meeting.company})`;

  // A stored Meet/Calendar link came from a previous auto-booking — only an
  // external link (Zoom, etc.) counts as a user-provided conference link.
  let customMeetingLink =
    meeting.meetingLink && !/meet\.google\.com|calendar\.google\.com/.test(meeting.meetingLink)
      ? meeting.meetingLink
      : null;

  const warnings: string[] = [];

  if (generateZoom) {
    try {
      const zoom = await createZoomMeeting({
        hostCandidates: [meeting.aeUserEmail, meeting.xdrUserEmail],
        topic: title,
        startIso: meeting.meetingDatetime,
        durationMinutes: MEETING_DURATION_MIN,
        existingJoinUrl: customMeetingLink,
      });
      customMeetingLink = zoom.joinUrl;
      if (meeting.aeUserEmail && zoom.hostEmail !== meeting.aeUserEmail) {
        warnings.push(
          `Zoom meeting is hosted by ${zoom.hostEmail} — ${meeting.aeUserEmail} hasn't connected Zoom, so Gong may not record it.`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw Object.assign(new Error(msg), { statusCode: 502 });
    }
  }

  let result: { eventId: string; meetingLink: string; ownerEmail: string };
  try {
    result = await bookCalendarEvent({
      title,
      datetime: meeting.meetingDatetime,
      prospectEmail: meeting.prospectEmail ?? undefined,
      aeEmail: meeting.aeUserEmail,
      xdrEmail: meeting.xdrUserEmail,
      description: meetingAgenda,
      existingEventId: meeting.calendarEventId,
      customMeetingLink,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw Object.assign(new Error(msg), { statusCode: 502 });
  }

  if (meeting.aeUserEmail && result.ownerEmail !== meeting.aeUserEmail) {
    warnings.push(
      `Calendar invite was created from ${result.ownerEmail}'s calendar — ${meeting.aeUserEmail} hasn't connected Google Calendar, so they aren't the meeting owner.`,
    );
  }

  // Conditional write: only commit if calendarEventId still matches what we
  // read before the (slow, network-bound) booking call above.
  const originalEventId = meeting.calendarEventId;
  const raceGuard = originalEventId
    ? eq(bookedMeetings.calendarEventId, originalEventId)
    : isNull(bookedMeetings.calendarEventId);

  const updated = await db
    .update(bookedMeetings)
    .set({ calendarEventId: result.eventId, meetingLink: result.meetingLink })
    .where(and(eq(bookedMeetings.id, meeting.id), eq(bookedMeetings.status, "confirmed"), raceGuard))
    .returning({ id: bookedMeetings.id });

  if (updated.length === 0) {
    const [current] = await db
      .select({ calendarEventId: bookedMeetings.calendarEventId, meetingLink: bookedMeetings.meetingLink })
      .from(bookedMeetings)
      .where(eq(bookedMeetings.id, meeting.id))
      .limit(1);
    warnings.push(
      "Another request booked this meeting's calendar event at the same time — showing that one instead of creating a duplicate.",
    );
    return {
      calendarEventId: current?.calendarEventId ?? result.eventId,
      meetingLink: current?.meetingLink ?? result.meetingLink,
      calendarOwner: result.ownerEmail,
      warnings,
    };
  }

  return {
    calendarEventId: result.eventId,
    meetingLink: result.meetingLink,
    calendarOwner: result.ownerEmail,
    warnings,
  };
}
