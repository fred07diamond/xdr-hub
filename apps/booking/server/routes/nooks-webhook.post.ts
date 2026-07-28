import crypto from "node:crypto";
import { defineEventHandler, getHeader, readRawBody, setResponseStatus } from "h3";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../db/index.js";
import { bookedMeetings, generatedNotes } from "../db/schema.js";
import { getSharedDb, workspaceUserRoles } from "../db/workspace.js";

// Nooks `call.logged` webhook receiver (see the Nooks partner API spec).
// A server route rather than an action because signature verification needs
// the RAW request body and headers.
//
// Fires for EVERY call in the workspace; we store something only when BOTH:
//   1. the disposition indicates a booked meeting, and
//   2. the rep is a member of workspace_user_roles (Team & Access roster).
// Everything else is acknowledged and dropped — no rows, no transcripts kept.

const CONNECTED_MEETING_RE = /connected[\s_-]*meeting|meeting[\s_-]*(booked|set|scheduled)/i;
const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;

function timingSafeEq(a: string, b: string): boolean {
  return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Nooks docs: s = base64(HMAC-SHA256(signingKey, t + "." + raw_body)) with
// t in unix-ms — but they don't pin down whether the HMAC key is the full
// "nooks-webhook-signing-key-<hex>" string, the hex suffix, or the decoded
// hex bytes, nor base64 vs base64url. Try each sane variant and log which
// one matched so the accepted set can be narrowed once known.
function verifySignature(rawBody: string, header: string | undefined, key: string): string | null {
  if (!header) return null;
  const tMatch = header.match(/t=(\d+)/);
  const sMatch = header.match(/s=([^,\s]+)/);
  if (!tMatch || !sMatch) return null;
  const tRaw = tMatch[1];
  let t = Number(tRaw);
  if (!Number.isFinite(t)) return null;
  if (tRaw.length <= 10) t *= 1000; // seconds → ms
  if (Math.abs(Date.now() - t) > MAX_SIGNATURE_AGE_MS) return null;

  const hexPart = key.replace(/^nooks-webhook-signing-key-/, "");
  const keyVariants: Array<[string, crypto.BinaryLike]> = [
    ["full-key", key],
    ["hex-suffix", hexPart],
    ["hex-bytes", Buffer.from(hexPart, "hex")],
  ];
  const provided = sMatch[1];
  for (const [keyName, keyMaterial] of keyVariants) {
    const mac = crypto.createHmac("sha256", keyMaterial).update(`${tRaw}.${rawBody}`);
    const digest = mac.digest();
    for (const [encName, encoded] of [
      ["base64", digest.toString("base64")],
      ["base64url", digest.toString("base64url")],
      ["hex", digest.toString("hex")],
    ] as const) {
      if (timingSafeEq(provided, encoded)) return `${keyName}/${encName}`;
    }
  }
  return null;
}

interface CallLoggedPayload {
  event?: string;
  callData?: {
    callId?: string;
    userData?: { email?: string | null; name?: string | null };
    prospectData?: {
      name?: string | null;
      email?: string | null;
      phoneNumber?: string | null;
      linkedInUrl?: string | null;
    };
    accountData?: { name?: string | null };
    disposition?: { id?: string | null; name?: string | null };
    startedAt?: string;
    durationSeconds?: number;
    recordingUrl?: string | null;
    notes?: string | null;
    transcriptUrl?: string | null;
    sequenceData?: { sequenceName?: string | null; sequenceStep?: string | null };
  };
}

export default defineEventHandler(async (event) => {
  const raw = (await readRawBody(event, "utf8")) ?? "";

  // Signature policy:
  //   header present + valid   → verified, full processing
  //   header present + invalid → 401 (tampered/misconfigured)
  //   header absent            → acknowledged but NEVER creates data — Nooks'
  //                              save-time verification ping arrives unsigned
  //                              and a 401 would make the URL save fail.
  const signingKey = process.env.NOOKS_WEBHOOK_SIGNING_KEY;
  const sigHeader = getHeader(event, "x-webhook-signature");
  let verified = false;
  if (signingKey && sigHeader) {
    const variant = verifySignature(raw, sigHeader, signingKey);
    verified = variant !== null;
    if (verified) {
      console.log(`[nooks-webhook] signature verified (${variant})`);
    } else {
      console.warn(
        "[nooks-webhook] signature verification failed — header:",
        sigHeader.slice(0, 120),
        "bodyLen:", raw.length,
        "bodyB64:", Buffer.from(raw).toString("base64").slice(0, 2400),
      );
      // Capture mode (NOOKS_SIG_CAPTURE=1): acknowledge mismatches so
      // Nooks' save-time signed test can succeed while a key rotation is
      // being sorted out. Data creation stays blocked (verified=false).
      if (process.env.NOOKS_SIG_CAPTURE !== "1") {
        setResponseStatus(event, 401);
        return { error: "invalid signature" };
      }
    }
  } else if (!signingKey) {
    console.warn("[nooks-webhook] NOOKS_WEBHOOK_SIGNING_KEY not set — treating request as unverified");
  } else {
    console.log("[nooks-webhook] unsigned request (likely a verification ping) — acknowledging without processing");
  }

  let payload: CallLoggedPayload;
  try {
    payload = JSON.parse(raw) as CallLoggedPayload;
  } catch {
    // Nooks' save-time ping may not be JSON — acknowledge it.
    console.log("[nooks-webhook] non-JSON body:", raw.slice(0, 200));
    return { received: true };
  }

  const call = payload.callData;
  const dispositionName = call?.disposition?.name ?? null;
  const repEmail = call?.userData?.email?.toLowerCase() ?? null;

  console.log(
    "[nooks-webhook]",
    JSON.stringify({
      event: payload.event,
      callId: call?.callId,
      disposition: dispositionName,
      repEmail,
      hasTranscriptUrl: !!call?.transcriptUrl,
      hasRecording: !!call?.recordingUrl,
    }),
  );

  if (payload.event !== "call.logged" || !call?.callId) return { received: true };
  // Data creation requires a verified signature (or no key configured yet).
  if (signingKey && !verified) {
    return { received: true, workflowInitiated: false, reason: "unsigned" };
  }
  if (!dispositionName || !CONNECTED_MEETING_RE.test(dispositionName)) {
    return { received: true, workflowInitiated: false };
  }
  if (!repEmail) return { received: true, workflowInitiated: false, reason: "no rep email" };

  try {
    // Roster gate: only calls from Team & Access members create anything.
    const sharedDb = getSharedDb();
    const member = await sharedDb
      .select({ email: workspaceUserRoles.email })
      .from(workspaceUserRoles)
      .where(eq(workspaceUserRoles.email, repEmail))
      .limit(1);
    if (!member[0]) {
      return { received: true, workflowInitiated: false, reason: "rep not in roster" };
    }

    const db = getDb();

    // Idempotency: Nooks retries deliveries; callId is the stable key.
    const existing = await db
      .select({ id: bookedMeetings.id })
      .from(bookedMeetings)
      .where(eq(bookedMeetings.nooksCallId, call.callId))
      .limit(1);
    if (existing[0]) {
      return { received: true, workflowInitiated: false, reason: "already processed" };
    }

    const meetingId = nanoid();
    const now = new Date().toISOString();

    await db
      .insert(bookedMeetings)
      .values({
        id: meetingId,
        nooksCallId: call.callId,
        prospectName: call.prospectData?.name ?? "Unknown Prospect",
        company: call.accountData?.name ?? "Unknown Company",
        prospectEmail: call.prospectData?.email ?? undefined,
        xdrUserEmail: member[0].email,
        aeUserEmail: "",
        status: "pending",
        createdAt: now,
      })
      .onConflictDoNothing();

    const referenceLines = [
      call.notes && `Rep call notes: ${call.notes}`,
      call.transcriptUrl && `Nooks transcript: ${call.transcriptUrl}`,
      call.recordingUrl && `Recording: ${call.recordingUrl}`,
      call.sequenceData?.sequenceName &&
        `Sequence: ${call.sequenceData.sequenceName}${call.sequenceData.sequenceStep ? ` — ${call.sequenceData.sequenceStep}` : ""}`,
      call.startedAt && `Call time: ${call.startedAt}`,
    ].filter(Boolean) as string[];

    await db.insert(generatedNotes).values({
      id: nanoid(),
      meetingId,
      xdrUserEmail: member[0].email,
      meetingAgenda: "",
      crmNotes: "",
      xdrNotes: referenceLines.join("\n"),
      followUpEmail: "",
      status: "draft",
      createdAt: now,
    });

    console.log("[nooks-webhook] created pending meeting", meetingId, "for", member[0].email);
    return { received: true, workflowInitiated: true, meetingId };
  } catch (err) {
    console.error("[nooks-webhook] processing error:", err instanceof Error ? err.message : err);
    // Acknowledge anyway — Nooks retries non-2xx for ~30 minutes and the
    // failure is on our side, not a delivery problem.
    return { received: true, workflowInitiated: false, reason: "internal error" };
  }
});
