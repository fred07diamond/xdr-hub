import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { bookedMeetings, generatedNotes } from "../server/db/schema.js";
import { bookMeetingOnCalendar } from "../server/helpers/book-meeting-on-calendar.js";
import { requireRole } from "../server/helpers/require-role.js";

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

    const result = await bookMeetingOnCalendar({
      db,
      meeting,
      meetingAgenda: notes?.meetingAgenda ?? "",
      generateZoom,
    });

    return { meetingId, ...result };
  },
});
