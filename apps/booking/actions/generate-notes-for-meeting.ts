import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { bookedMeetings } from "../server/db/schema.js";
import { applyGeneratedNotes } from "../server/helpers/apply-generated-notes.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "Generate meeting agenda, CRM notes, and follow-up email for an existing booked meeting from a pasted call transcript.",
  schema: z.object({
    meetingId: z.string().min(1),
    transcript: z.string().min(1),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ meetingId, transcript }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "admin"]);

    const db = getDb();
    const [meeting] = await db
      .select()
      .from(bookedMeetings)
      .where(eq(bookedMeetings.id, meetingId))
      .limit(1);

    if (!meeting) {
      throw Object.assign(new Error("Meeting not found"), { statusCode: 404 });
    }

    // The webhook-created meeting often has no confirmed time yet --
    // applyGeneratedNotes fills it in from the transcript when empty.
    const { fields } = await applyGeneratedNotes({
      db,
      meetingId,
      meetingDatetime: meeting.meetingDatetime,
      xdrUserEmail: ctx!.userEmail,
      transcript,
    });

    return { meetingId, generatedNotes: fields };
  },
});
