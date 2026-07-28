import { defineAction } from "@agent-native/core";
import { getOAuthAccounts } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { bookedMeetings, deals, generatedNotes } from "../server/db/schema.js";
import { fillAePlaceholders, getOwnerName } from "../server/helpers/ae-name.js";
import { bookCalendarEvent } from "../server/helpers/book-calendar-event.js";
import { createHubspotDeal } from "../server/helpers/create-hubspot-deal.js";
import { requireRole } from "../server/helpers/require-role.js";
import { sendFollowupEmail } from "../server/helpers/send-followup-email.js";

export default defineAction({
  description:
    "Confirm XDR-reviewed outputs. Creates HubSpot deal, books Google Calendar event, and sends follow-up email — all in parallel.",
  schema: z.object({
    meetingId: z.string().min(1),
    notes: z.object({
      meetingAgenda: z.string(),
      xdrPain: z.string(),
      xdrEnterpriseNeed: z.string(),
      xdrContactQualification: z.string(),
      xdrNotes: z.string(),
      followUpEmail: z.string(),
    }),
    meetingDetails: z.object({
      prospectName: z.string(),
      prospectEmail: z.string().email().optional(),
      company: z.string(),
      meetingDatetime: z.string(),
      aeEmail: z.string().email(),
      emailSubject: z.string().optional(),
    }),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ meetingId, notes, meetingDetails }, ctx) => {
    // Capture role so admin bypass can be applied to ownership check (Finding 2)
    const role = await requireRole(ctx?.userEmail, ["xdr", "admin"]);

    // Retrieve stored Google OAuth token server-side instead of accepting from client (Finding 6)
    const accounts = await getOAuthAccounts("google", ctx!.userEmail);
    const googleAccessToken = accounts[0]?.tokens?.access_token as string | undefined;
    if (!googleAccessToken) {
      throw Object.assign(
        new Error("Google account not connected. Visit /_agent-native/connections to connect Google."),
        { statusCode: 400 }
      );
    }

    const db = getDb();
    const [meeting] = await db
      .select()
      .from(bookedMeetings)
      .where(eq(bookedMeetings.id, meetingId))
      .limit(1);

    if (!meeting) {
      throw Object.assign(new Error("Meeting not found"), { statusCode: 404 });
    }
    // Admins may confirm any meeting; XDRs may only confirm their own (Finding 2)
    if (role !== "admin" && meeting.xdrUserEmail !== ctx!.userEmail) {
      throw Object.assign(new Error("Access denied — this meeting belongs to another XDR"), { statusCode: 403 });
    }

    // Atomic status claim: update pending → confirmed in a single DB round-trip to prevent
    // TOCTOU races where two concurrent requests both pass the status check (Finding 3)
    const claimed = await db
      .update(bookedMeetings)
      .set({ status: "confirmed" })
      .where(and(eq(bookedMeetings.id, meetingId), eq(bookedMeetings.status, "pending")))
      .returning({ id: bookedMeetings.id });

    if (claimed.length === 0) {
      // Meeting exists (we read it above) but was not in pending state
      throw Object.assign(new Error("Meeting already confirmed"), { statusCode: 409 });
    }

    // The AE may have been corrected during review — fill any placeholders
    // still present with the final AE's name before sending anything.
    const aeName = await getOwnerName(meetingDetails.aeEmail);
    if (aeName) {
      notes.followUpEmail = fillAePlaceholders(notes.followUpEmail, aeName);
      if (meetingDetails.emailSubject) {
        meetingDetails.emailSubject = fillAePlaceholders(meetingDetails.emailSubject, aeName);
      }
    }

    const subject =
      meetingDetails.emailSubject ??
      `Builder.io Discovery — ${meetingDetails.prospectName} — following up`;

    // Skip follow-up email when no prospect email is available rather than guessing (Finding 4)
    const [hubspotResult, calendarResult, emailResult] = await Promise.allSettled([
      createHubspotDeal({
        dealName: `${meetingDetails.prospectName} — ${meetingDetails.company}`,
        associatedContact: meetingDetails.prospectName,
        company: meetingDetails.company,
        aeEmail: meetingDetails.aeEmail,
        crmNotes: [
          notes.xdrPain && `XDR: Pain: ${notes.xdrPain}`,
          notes.xdrEnterpriseNeed && `XDR: Enterprise Need: ${notes.xdrEnterpriseNeed}`,
          notes.xdrContactQualification && `XDR: Contact Qualification: ${notes.xdrContactQualification}`,
          notes.xdrNotes && `XDR: Notes: ${notes.xdrNotes}`,
        ].filter(Boolean).join("\n\n"),
      }),
      bookCalendarEvent({
        title: `Builder.io Discovery — ${meetingDetails.prospectName} (${meetingDetails.company})`,
        datetime: meetingDetails.meetingDatetime,
        prospectEmail: meetingDetails.prospectEmail,
        aeEmail: meetingDetails.aeEmail,
        xdrEmail: ctx!.userEmail,
        description: notes.meetingAgenda,
      }),
      meetingDetails.prospectEmail
        ? sendFollowupEmail({
            xdrEmail: ctx!.userEmail,
            prospectEmail: meetingDetails.prospectEmail,
            aeEmail: meetingDetails.aeEmail,
            subject,
            body: notes.followUpEmail,
            accessToken: googleAccessToken,
          })
        : Promise.resolve(null),
    ]);

    const hubspotDealId =
      hubspotResult.status === "fulfilled" ? hubspotResult.value.dealId : null;
    const calendarEventId =
      calendarResult.status === "fulfilled" ? calendarResult.value.eventId : null;
    const meetingLink =
      calendarResult.status === "fulfilled" ? calendarResult.value.meetingLink : null;
    // emailSent is false when the send was skipped (null) or failed
    const emailSent = emailResult.status === "fulfilled" && emailResult.value !== null;

    const now = new Date().toISOString();

    // Update remaining meeting fields — status was already set to "confirmed" atomically above
    await db
      .update(bookedMeetings)
      .set({
        aeUserEmail: meetingDetails.aeEmail,
        meetingDatetime: meetingDetails.meetingDatetime,
        calendarEventId: calendarEventId ?? undefined,
        meetingLink: meetingLink ?? undefined,
      })
      .where(eq(bookedMeetings.id, meetingId));

    await db
      .update(generatedNotes)
      .set({
        meetingAgenda: notes.meetingAgenda,
        xdrPain: notes.xdrPain,
        xdrEnterpriseNeed: notes.xdrEnterpriseNeed,
        xdrContactQualification: notes.xdrContactQualification,
        xdrNotes: notes.xdrNotes,
        followUpEmail: notes.followUpEmail,
        status: "confirmed",
        confirmedAt: now,
      })
      .where(eq(generatedNotes.meetingId, meetingId));

    if (hubspotDealId) {
      await db.insert(deals).values({
        id: nanoid(),
        meetingId,
        dealName: `${meetingDetails.prospectName} — ${meetingDetails.company}`,
        associatedContact: meetingDetails.prospectName,
        company: meetingDetails.company,
        aeOwnerEmail: meetingDetails.aeEmail,
        hubspotDealId,
        createdAt: now,
      });
    }

    return {
      meetingId,
      hubspotDealId,
      calendarEventId,
      meetingLink,
      emailSent,
      status: "confirmed",
      errors: {
        hubspot:
          hubspotResult.status === "rejected"
            ? String(hubspotResult.reason)
            : null,
        calendar:
          calendarResult.status === "rejected"
            ? String(calendarResult.reason)
            : null,
        email:
          emailResult.status === "rejected"
            ? String(emailResult.reason)
            : null,
      },
    };
  },
});
