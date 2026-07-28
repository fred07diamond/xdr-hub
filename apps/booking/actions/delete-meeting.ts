import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { bookedMeetings } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Permanently delete a booked meeting by ID.",
  schema: z.object({
    meetingId: z.string().min(1),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ meetingId }, ctx) => {
    const role = await requireRole(ctx?.userEmail, ["xdr", "admin"]);
    const db = getDb();

    const [existing] = await db
      .select()
      .from(bookedMeetings)
      .where(eq(bookedMeetings.id, meetingId))
      .limit(1);

    if (!existing) {
      throw Object.assign(new Error("Meeting not found"), { statusCode: 404 });
    }
    if (role === "xdr" && existing.xdrUserEmail !== ctx!.userEmail) {
      throw Object.assign(new Error("Access denied"), { statusCode: 403 });
    }

    await db.delete(bookedMeetings).where(eq(bookedMeetings.id, meetingId));

    return { meetingId, deleted: true };
  },
});
