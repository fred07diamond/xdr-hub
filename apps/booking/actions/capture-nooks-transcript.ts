import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { bookedMeetings } from "../server/db/schema.js";
import { applyGeneratedNotes } from "../server/helpers/apply-generated-notes.js";
import { generateNotes } from "../server/helpers/generate-notes.js";
import { requireRole } from "../server/helpers/require-role.js";
import { resolveOwner } from "../server/helpers/resolve-owner.js";

export default defineAction({
  description:
    "Ingest a call transcript captured by the Nooks Capture browser extension and generate meeting notes for the matching booked meeting, self-healing the meeting row if Nooks' own call.logged webhook hasn't created it yet.",
  schema: z.object({
    nooksCallId: z.string().min(1),
    transcript: z.string().min(1),
    truncated: z.boolean().nullish(),
    apiToken: z.string().nullish(),
  }),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: false, requiresAuth: false },
  http: { method: "POST" },
  run: async ({ nooksCallId, transcript, truncated, apiToken }, ctx) => {
    const ownerEmail = await resolveOwner(apiToken, ctx);
    await requireRole(ownerEmail ?? undefined, ["xdr", "admin"]);

    const db = getDb();

    const [existingMeeting] = await db
      .select()
      .from(bookedMeetings)
      .where(eq(bookedMeetings.nooksCallId, nooksCallId))
      .limit(1);

    let meeting = existingMeeting;
    let selfHealed = false;
    // The AI notes pipeline already extracts prospectName/company from the
    // transcript -- reuse that instead of a hardcoded placeholder when this
    // action has to create the meeting row itself.
    let notesResult: Awaited<ReturnType<typeof generateNotes>> | null = null;

    if (!meeting) {
      // Race: the rep clicked Send before Nooks' call.logged webhook fired.
      // Generate notes first so we have a real prospect name/company to
      // seed the row with, then self-heal-insert it.
      notesResult = await generateNotes(transcript);
      const id = nanoid();
      const now = new Date().toISOString();
      await db
        .insert(bookedMeetings)
        .values({
          id,
          nooksCallId,
          prospectName: notesResult.prospectName,
          company: notesResult.company,
          meetingDatetime: notesResult.meetingDatetime ?? undefined,
          xdrUserEmail: ownerEmail!,
          aeUserEmail: "",
          status: "pending",
          createdAt: now,
        })
        // The real unique index on nooks_call_id (idx_booked_meetings_nooks_call_id)
        // means a genuinely concurrent insert from the webhook lands here as a
        // no-op instead of throwing -- re-select below to pick up whichever
        // row actually won.
        .onConflictDoNothing();

      const [row] = await db
        .select()
        .from(bookedMeetings)
        .where(eq(bookedMeetings.nooksCallId, nooksCallId))
        .limit(1);
      meeting = row;
      selfHealed = true;
    }

    if (!meeting) {
      throw Object.assign(new Error("Failed to create or find the booked meeting."), { statusCode: 500 });
    }

    // Reuse the already-generated notes when this action just created the
    // meeting, instead of calling the LLM a second time for the same call.
    const { fields } = await applyGeneratedNotes({
      db,
      meetingId: meeting.id,
      meetingDatetime: meeting.meetingDatetime,
      xdrUserEmail: ownerEmail!,
      transcript,
      precomputedNotes: notesResult ?? undefined,
    });

    return { meetingId: meeting.id, selfHealed, truncated: truncated ?? false, generatedNotes: fields };
  },
});
