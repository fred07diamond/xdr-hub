import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { fetchCalendarEvents } from "../server/helpers/google-calendar-events.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "Fetch Google Calendar events for the current user using their stored Google OAuth token.",
  schema: z.object({
    from: z.string(),
    to: z.string(),
    calendarEmail: z.string().email().optional(),
  }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ from, to, calendarEmail }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    return fetchCalendarEvents({ ownerEmail: ctx!.userEmail!, from, to, calendarEmail });
  },
});
