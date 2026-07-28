// actions/receive-nooks-webhook.ts
// Nooks' "Call Logging Webhooks" setting (Settings → Integrations → Webhooks)
// takes a single URL with no payload documentation, event picker, or signing
// secret. This receiver is therefore tolerant: it accepts any JSON body, logs
// a truncated copy (read it with the Netlify function logs to refine field
// mappings), and tries the common field-name variants before acting.
import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { bookedMeetings, generatedNotes } from "../server/db/schema.js";
import { getSharedDb, workspaceUserRoles } from "../server/db/workspace.js";
import { generateNotes } from "../server/helpers/generate-notes.js";

// Dispositions that mean "a meeting got booked on this call".
const CONNECTED_MEETING_RE = /connected[\s_-]*meeting|meeting[\s_-]*(booked|set|scheduled)/i;

function pick(
  sources: Array<Record<string, unknown> | null>,
  keys: string[],
): string | null {
  for (const src of sources) {
    if (!src) continue;
    for (const k of keys) {
      const v = src[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}

export default defineAction({
  description:
    "Receive Nooks call-logging webhooks. Auto-initiates the booking workflow when a call's disposition indicates a booked meeting.",
  schema: z.object({}).passthrough(),
  requiresAuth: false,
  http: { method: "POST" },
  run: async (payload) => {
    const p = payload as Record<string, unknown>;
    const call =
      typeof p.call === "object" && p.call !== null
        ? (p.call as Record<string, unknown>)
        : null;
    const data =
      typeof p.data === "object" && p.data !== null
        ? (p.data as Record<string, unknown>)
        : null;
    const sources = [p, call, data];

    console.log("[nooks-webhook] payload:", JSON.stringify(payload).slice(0, 3000));

    const disposition = pick(sources, [
      "disposition", "call_disposition", "callDisposition",
      "dispositionName", "disposition_name", "outcome",
    ]);
    const transcript = pick(sources, [
      "transcript", "call_transcript", "callTranscript",
      "transcription", "transcript_text", "transcriptText",
    ]);
    const repEmail = pick(sources, [
      "rep_email", "repEmail", "user_email", "userEmail",
      "caller_email", "callerEmail", "agent_email", "rep_id", "repId", "email",
    ]);

    console.log(
      "[nooks-webhook] extracted:",
      JSON.stringify({ disposition, repEmail, transcriptChars: transcript?.length ?? 0 }),
    );

    if (!disposition || !CONNECTED_MEETING_RE.test(disposition)) {
      return { received: true, workflowInitiated: false, disposition };
    }
    if (!transcript) {
      return {
        received: true,
        workflowInitiated: false,
        reason: "No transcript in payload — XDR must paste manually",
      };
    }
    if (!repEmail || !repEmail.includes("@")) {
      return {
        received: true,
        workflowInitiated: false,
        reason: "No rep email in payload — cannot attribute the meeting",
      };
    }

    try {
      const sharedDb = getSharedDb();
      const xdr = await sharedDb
        .select({ email: workspaceUserRoles.email })
        .from(workspaceUserRoles)
        .where(eq(workspaceUserRoles.email, repEmail.toLowerCase()))
        .limit(1);

      if (!xdr[0]) {
        return {
          received: true,
          workflowInitiated: false,
          reason: `Rep ${repEmail} not found in workspace_user_roles — onboard them first`,
        };
      }

      const notes = await generateNotes(transcript);
      const db = getDb();
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

      await db.insert(generatedNotes).values({
        id: nanoid(),
        meetingId,
        xdrUserEmail: xdr[0].email,
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
      console.error("[nooks-webhook] workflow error:", err instanceof Error ? err.message : err);
      return { received: true, workflowInitiated: false, reason: "internal error" };
    }
  },
});
