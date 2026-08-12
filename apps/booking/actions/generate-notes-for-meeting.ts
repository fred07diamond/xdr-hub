import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { bookedMeetings, generatedNotes } from "../server/db/schema.js";
import { generateNotes } from "../server/helpers/generate-notes.js";
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

    const notes = await generateNotes(transcript);

    const [existing] = await db
      .select()
      .from(generatedNotes)
      .where(eq(generatedNotes.meetingId, meetingId))
      .limit(1);

    const fields = {
      meetingAgenda: notes.meetingAgenda,
      xdrPain: notes.xdrPain,
      xdrEnterpriseNeed: notes.xdrEnterpriseNeed,
      xdrContactQualification: notes.xdrContactQualification,
      xdrNotes: notes.xdrNotes,
      followUpEmail: notes.followUpEmail,
      emailSubject: notes.emailSubject,
    };

    if (existing) {
      await db.update(generatedNotes).set(fields).where(eq(generatedNotes.id, existing.id));
    } else {
      await db.insert(generatedNotes).values({
        id: nanoid(),
        meetingId,
        xdrUserEmail: ctx!.userEmail,
        crmNotes: "",
        status: "draft",
        createdAt: new Date().toISOString(),
        ...fields,
      });
    }

    // The webhook-created meeting often has no confirmed time yet -- fill it
    // in from the transcript if the meeting doesn't already have one.
    if (!meeting.meetingDatetime && notes.meetingDatetime) {
      await db
        .update(bookedMeetings)
        .set({ meetingDatetime: notes.meetingDatetime })
        .where(eq(bookedMeetings.id, meetingId));
    }

    return { meetingId, generatedNotes: fields };
  },
});
