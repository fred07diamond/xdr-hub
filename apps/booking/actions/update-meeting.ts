import { defineAction } from "@agent-native/core";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { bookedMeetings } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Update editable fields on a booked meeting (name, datetime, AE email, status, etc.).",
  schema: z.object({
    meetingId: z.string().min(1),
    prospectName: z.string().min(1).optional(),
    company: z.string().min(1).optional(),
    prospectEmail: z.string().email().nullable().optional(),
    meetingDatetime: z.string().nullable().optional(),
    aeUserEmail: z.string().email().optional(),
    meetingLink: z.string().url().nullable().optional(),
    status: z.enum(["pending", "confirmed", "cancelled"]).optional(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ meetingId, ...patch }, ctx) => {
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

    // Only include fields that were explicitly passed
    const updates: Record<string, unknown> = {};
    if (patch.prospectName !== undefined) updates.prospectName = patch.prospectName;
    if (patch.company !== undefined) updates.company = patch.company;
    if (patch.prospectEmail !== undefined) updates.prospectEmail = patch.prospectEmail;
    if (patch.meetingDatetime !== undefined) updates.meetingDatetime = patch.meetingDatetime;
    if (patch.aeUserEmail !== undefined) updates.aeUserEmail = patch.aeUserEmail;
    if (patch.meetingLink !== undefined) updates.meetingLink = patch.meetingLink;
    if (patch.status !== undefined) updates.status = patch.status;

    if (Object.keys(updates).length === 0) {
      return { meetingId, updated: false };
    }

    await db
      .update(bookedMeetings)
      .set(updates as any)
      .where(eq(bookedMeetings.id, meetingId));

    return { meetingId, updated: true };
  },
});
