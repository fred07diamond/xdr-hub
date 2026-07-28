import { defineAction } from "@agent-native/core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { bookedMeetings, generatedNotes } from "../server/db/schema.js";
import { generateNotes } from "../server/helpers/generate-notes.js";
import { lookupContactByName } from "../server/helpers/lookup-contact.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "Accept a Nooks call transcript, generate meeting agenda, CRM notes, and follow-up email via AI, then return a draft for XDR review.",
  schema: z.object({
    transcript: z.string().min(1),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ transcript }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "admin"]);

    const notes = await generateNotes(transcript);

    // Enrich from HubSpot: match prospect → get contact owner (XDR) + company owner (AE)
    const hubspot = await lookupContactByName(notes.prospectName, notes.company);

    // Prefer HubSpot canonical values over AI extraction
    const prospectName = hubspot.prospectName ?? notes.prospectName;
    const company = hubspot.company ?? notes.company;
    const resolvedAeEmail = hubspot.companyOwnerEmail ?? null;
    const xdrOwnerEmail = hubspot.contactOwnerEmail ?? null;

    const db = getDb();
    const meetingId = nanoid();
    const notesId = nanoid();
    const now = new Date().toISOString();

    await db.insert(bookedMeetings).values({
      id: meetingId,
      prospectName,
      prospectEmail: hubspot.prospectEmail,
      company,
      meetingDatetime: notes.meetingDatetime,
      aeUserEmail: resolvedAeEmail ?? "",
      xdrUserEmail: ctx!.userEmail,
      status: "pending",
      createdAt: now,
    });

    await db.insert(generatedNotes).values({
      id: notesId,
      meetingId,
      xdrUserEmail: ctx!.userEmail,
      meetingAgenda: notes.meetingAgenda,
      crmNotes: "",
      xdrPain: notes.xdrPain,
      xdrEnterpriseNeed: notes.xdrEnterpriseNeed,
      xdrContactQualification: notes.xdrContactQualification,
      xdrNotes: notes.xdrNotes,
      followUpEmail: notes.followUpEmail,
      emailSubject: notes.emailSubject,
      status: "draft",
      createdAt: now,
    });

    return {
      meetingId,
      generatedNotes: {
        meetingAgenda: notes.meetingAgenda,
        xdrPain: notes.xdrPain,
        xdrEnterpriseNeed: notes.xdrEnterpriseNeed,
        xdrContactQualification: notes.xdrContactQualification,
        xdrNotes: notes.xdrNotes,
        followUpEmail: notes.followUpEmail,
        emailSubject: notes.emailSubject,
      },
      extractedMeeting: {
        prospectName,
        prospectEmail: hubspot.prospectEmail,
        company,
        meetingDatetime: notes.meetingDatetime,
        aeEmail: resolvedAeEmail,
        xdrOwnerEmail,
        needsDatetime: !notes.meetingDatetime,
        needsAe: !resolvedAeEmail,
      },
      status: "draft",
    };
  },
});
