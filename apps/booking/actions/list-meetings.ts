import { defineAction } from "@agent-native/core";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { bookedMeetings } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "List meetings. XDRs see their own. AEs see meetings assigned to them. Admins see all.",
  schema: z.object({
    status: z.enum(["pending", "confirmed", "cancelled"]).optional(),
  }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ status }, ctx) => {
    const role = await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    const filters = [];
    if (role === "xdr") filters.push(eq(bookedMeetings.xdrUserEmail, ctx!.userEmail));
    if (role === "ae") filters.push(eq(bookedMeetings.aeUserEmail, ctx!.userEmail));
    if (status) filters.push(eq(bookedMeetings.status, status));

    const rows = await db
      .select({
        id: bookedMeetings.id,
        prospectName: bookedMeetings.prospectName,
        company: bookedMeetings.company,
        prospectEmail: bookedMeetings.prospectEmail,
        meetingDatetime: bookedMeetings.meetingDatetime,
        aeUserEmail: bookedMeetings.aeUserEmail,
        xdrUserEmail: bookedMeetings.xdrUserEmail,
        calendarEventId: bookedMeetings.calendarEventId,
        meetingLink: bookedMeetings.meetingLink,
        status: bookedMeetings.status,
        createdAt: bookedMeetings.createdAt,
      })
      .from(bookedMeetings)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(bookedMeetings.createdAt));

    return { meetings: rows };
  },
});
