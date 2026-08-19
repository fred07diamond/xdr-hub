import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { getDb } from "../db/index.js";
import { bookedMeetings, generatedNotes } from "../db/schema.js";
import { generateNotes, type GeneratedNotes } from "./generate-notes.js";

// Shared by generate-notes-for-meeting.ts (manual transcript paste) and
// capture-nooks-transcript.ts (extension-captured transcript): runs the
// transcript through the AI notes pipeline, writes the result into
// generatedNotes (insert-or-update), and backfills bookedMeetings.
// meetingDatetime if it was still empty. Kept in one place so the two
// callers can't drift out of sync.
export async function applyGeneratedNotes({
  db,
  meetingId,
  meetingDatetime,
  xdrUserEmail,
  transcript,
  precomputedNotes,
}: {
  db: ReturnType<typeof getDb>;
  meetingId: string;
  meetingDatetime: string | null;
  xdrUserEmail: string;
  transcript: string;
  /** Skip re-running the LLM when the caller already has a fresh result (e.g. it just ran generateNotes to seed a self-healed meeting row). */
  precomputedNotes?: GeneratedNotes;
}): Promise<{ notes: GeneratedNotes; fields: Record<string, string> }> {
  const notes = precomputedNotes ?? (await generateNotes(transcript));

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
      xdrUserEmail,
      crmNotes: "",
      status: "draft",
      createdAt: new Date().toISOString(),
      ...fields,
    });
  }

  if (!meetingDatetime && notes.meetingDatetime) {
    await db
      .update(bookedMeetings)
      .set({ meetingDatetime: notes.meetingDatetime })
      .where(eq(bookedMeetings.id, meetingId));
  }

  return { notes, fields };
}
