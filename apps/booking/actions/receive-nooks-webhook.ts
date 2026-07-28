// actions/receive-nooks-webhook.ts
// Should Have — wired up in v1 but not yet activated.
// The webhook trigger is inactive until the Nooks CSM confirms:
//  1. The exact payload schema (field names for call_id, disposition, transcript, rep_id)
//  2. The exact disposition string for "Connected-Meeting"
//  3. Whether webhook delivery requires activation by Nooks support
//
// To activate: update CONNECTED_MEETING_DISPOSITION to the confirmed string,
// then remove this comment block.
import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { bookedMeetings, generatedNotes } from "../server/db/schema.js";
import { getSharedDb, workspaceUserRoles } from "../server/db/workspace.js";
import { generateNotes } from "../server/helpers/generate-notes.js";

const CONNECTED_MEETING_DISPOSITION = "Connected-Meeting";

export default defineAction({
  description:
    "Receive Nooks call disposition webhooks. Initiates workflow automatically for Connected-Meeting dispositions.",
  schema: z.object({
    call_id: z.string(),
    disposition: z.string(),
    transcript: z.string().optional(),
    rep_id: z.string(),
    secret: z.string().optional(),
  }),
  requiresAuth: false,
  http: { method: "POST" },
  run: async ({ call_id, disposition, transcript, rep_id, secret }) => {
    // Validate webhook secret when NOOKS_WEBHOOK_SECRET is configured
    const expectedSecret = process.env.NOOKS_WEBHOOK_SECRET;
    if (expectedSecret && secret !== expectedSecret) {
      throw Object.assign(new Error("Invalid webhook secret"), { statusCode: 401 });
    }

    if (disposition !== CONNECTED_MEETING_DISPOSITION) {
      return { received: true, workflowInitiated: false };
    }

    if (!transcript) {
      return {
        received: true,
        workflowInitiated: false,
        reason: "No transcript in payload — XDR must paste manually",
      };
    }

    // Look up XDR by rep_id (Nooks rep ID must match email in workspace_user_roles)
    try {
      const sharedDb = getSharedDb();
      const xdr = await sharedDb
        .select({ email: workspaceUserRoles.email })
        .from(workspaceUserRoles)
        .where(eq(workspaceUserRoles.email, rep_id))
        .limit(1);

      if (!xdr[0]) {
        return {
          received: true,
          workflowInitiated: false,
          reason: `Rep ${rep_id} not found in workspace_user_roles — onboard them first`,
        };
      }

      const notes = await generateNotes(transcript);
      const db = getDb();

      // Persist the meeting and generated notes to the DB
      const meetingId = nanoid();
      const now = new Date().toISOString();

      await db.insert(bookedMeetings).values({
        id: meetingId,
        prospectName: notes.prospectName ?? "Unknown Prospect",
        company: notes.company ?? "Unknown Company",
        meetingDatetime: notes.meetingDatetime ?? undefined,
        aeUserEmail: notes.aeEmail ?? "",
        xdrUserEmail: xdr[0].email,
        status: "pending",
        createdAt: now,
      });

      const notesId = nanoid();
      await db.insert(generatedNotes).values({
        id: notesId,
        meetingId,
        xdrUserEmail: xdr[0].email,
        meetingAgenda: notes.meetingAgenda,
        crmNotes: notes.crmNotes,
        followUpEmail: notes.followUpEmail,
        status: "draft",
        createdAt: now,
      });

      return {
        received: true,
        workflowInitiated: true,
        meetingId,
        repEmail: xdr[0].email,
        preview: {
          prospectName: notes.prospectName,
          company: notes.company,
          meetingDatetime: notes.meetingDatetime,
        },
      };
    } catch (err) {
      return {
        received: true,
        workflowInitiated: false,
        reason: "internal error",
      };
    }
  },
});
