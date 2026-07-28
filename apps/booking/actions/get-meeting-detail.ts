import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { bookedMeetings, generatedNotes } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Fetch full detail for one meeting including generated notes.",
  schema: z.object({ meetingId: z.string().min(1) }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ meetingId }, ctx) => {
    const role = await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    const [meeting] = await db
      .select()
      .from(bookedMeetings)
      .where(eq(bookedMeetings.id, meetingId))
      .limit(1);

    if (!meeting) {
      throw Object.assign(new Error("Meeting not found"), { statusCode: 404 });
    }
    if (role === "xdr" && meeting.xdrUserEmail !== ctx!.userEmail) {
      throw Object.assign(new Error("Access denied"), { statusCode: 403 });
    }
    if (role === "ae" && meeting.aeUserEmail !== ctx!.userEmail) {
      throw Object.assign(new Error("Access denied"), { statusCode: 403 });
    }

    const [notes] = await db
      .select()
      .from(generatedNotes)
      .where(eq(generatedNotes.meetingId, meetingId))
      .limit(1);

    return { meeting, notes: notes ?? null };
  },
});
