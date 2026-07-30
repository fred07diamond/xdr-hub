import { defineAction } from "@agent-native/core";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { bookedMeetings, generatedNotes } from "../server/db/schema.js";
import { bookCalendarEvent } from "../server/helpers/book-calendar-event.js";
import { createZoomMeeting } from "../server/helpers/create-zoom-meeting.js";
import { requireRole } from "../server/helpers/require-role.js";

const MEETING_DURATION_MIN = 45;

export default defineAction({
  description:
    "Create or update the Google Calendar event for a confirmed meeting — books on the XDR's connected Google Calendar with the AE and prospect as attendees, or moves the existing event to the current meeting time.",
  schema: z.object({
    meetingId: z.string().min(1),
    // Generate a unique Zoom meeting on the XDR's connected Zoom account and
    // use its join link as the event's conference.
    generateZoom: z.boolean().optional(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ meetingId, generateZoom }, ctx) => {
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
    if (meeting.status !== "confirmed") {
      throw Object.assign(
        new Error("Only confirmed meetings get calendar invites — confirm the meeting first."),
        { statusCode: 400 },
      );
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

    const title = `Builder.io Discovery — ${meeting.prospectName} (${meeting.company})`;

    // A stored Meet/Calendar link came from a previous auto-booking — only an
    // external link (Zoom, etc.) counts as a user-provided conference link.
    let customMeetingLink =
      meeting.meetingLink &&
      !/meet\.google\.com|calendar\.google\.com/.test(meeting.meetingLink)
        ? meeting.meetingLink
        : null;

    const warnings: string[] = [];

    if (generateZoom) {
      try {
        const zoom = await createZoomMeeting({
          // AE first — the AE should host so Gong records the call.
          hostCandidates: [meeting.aeUserEmail, meeting.xdrUserEmail],
          topic: title,
          startIso: meeting.meetingDatetime,
          durationMinutes: MEETING_DURATION_MIN,
          // Reuse the meeting's existing Zoom link when there is one — patch
          // its time/topic instead of minting a new link on every save.
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
        description: notes?.meetingAgenda ?? "",
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
    // read before the (slow, network-bound) booking call above. If a
    // concurrent call already wrote a different result in the meantime, this
    // affects 0 rows instead of silently clobbering it — the loser reports
    // the winner's result rather than presenting two different truths.
    const originalEventId = meeting.calendarEventId;
    const raceGuard = originalEventId
      ? eq(bookedMeetings.calendarEventId, originalEventId)
      : isNull(bookedMeetings.calendarEventId);

    const updated = await db
      .update(bookedMeetings)
      .set({
        calendarEventId: result.eventId,
        meetingLink: result.meetingLink,
      })
      .where(and(eq(bookedMeetings.id, meetingId), eq(bookedMeetings.status, "confirmed"), raceGuard))
      .returning({ id: bookedMeetings.id });

    if (updated.length === 0) {
      const [current] = await db
        .select({ calendarEventId: bookedMeetings.calendarEventId, meetingLink: bookedMeetings.meetingLink })
        .from(bookedMeetings)
        .where(eq(bookedMeetings.id, meetingId))
        .limit(1);
      warnings.push(
        "Another request booked this meeting's calendar event at the same time — showing that one instead of creating a duplicate.",
      );
      return {
        meetingId,
        calendarEventId: current?.calendarEventId ?? result.eventId,
        meetingLink: current?.meetingLink ?? result.meetingLink,
        calendarOwner: result.ownerEmail,
        warnings,
      };
    }

    return {
      meetingId,
      calendarEventId: result.eventId,
      meetingLink: result.meetingLink,
      calendarOwner: result.ownerEmail,
      warnings,
    };
  },
});
