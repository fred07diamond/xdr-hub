import { fillFollowUp } from "../core/drafting/follow-up.js";
// Sending one follow-up (D101): the lead's owner, from their Gmail, as a
// reply in the first touch's thread. Same guarantees as the first touch
// (D96): owner only, passes the checks, sent once through the outbox key.
// One more: HubSpot is read right before it goes out, so a lead who just
// replied never gets the next email.
import { leadOwnerEmail } from "../core/outreach/delivery.js";
import type { PaRepository } from "../core/repo/types.js";
import { SendRefused, senderFirstName } from "./first-touch-send.js";
import { firstTouchOf, replySubject } from "./follow-ups.js";
import { GmailError, newMessageId, type GmailClient } from "./gmail.js";

export interface FollowUpSendDeps {
  repository: PaRepository;
  gmail: GmailClient;
  now: () => Date;
  newId: () => string;
  /** Why to stop now (a reply, a meeting, a stage change), or null. */
  stopReason: (engagementId: string) => Promise<string | null>;
  stop: (engagementId: string, reason: string) => Promise<unknown>;
  /** The route's meeting link, to fill [meeting link]. */
  linkFor: (engagementId: string) => Promise<string | null>;
  /** Rolling 24 hour caps from the cadence settings (D103). */
  caps?: { daily_cap: number; company_daily_cap: number };
}

export const followUpKey = (id: string) => `follow_up:${id}`;

export async function sendFollowUp(
  deps: FollowUpSendDeps,
  input: { followUpId: string; actorEmail: string },
) {
  const { repository } = deps;
  const row = await repository.getFollowUp(input.followUpId);
  if (!row) throw new SendRefused("Follow-up not found", "not_found", 404);
  const engagement = await repository.getEngagement(row.engagementId);
  if (!engagement) throw new SendRefused("Lead not found", "not_found", 404);
  const actor = input.actorEmail.toLowerCase();
  const owner = await leadOwnerEmail(repository, engagement);
  if (!owner || owner !== actor)
    throw new SendRefused(
      owner
        ? `Only ${owner} can send this. It goes out from the owner's own Gmail.`
        : "This lead has no owner, so there is no Gmail to send it from.",
      "not_owner",
      403,
    );
  if (row.status === "sent")
    throw new SendRefused("This follow-up already went out.", "already_sent");
  if (row.status === "stopped")
    throw new SendRefused(
      `Follow-ups stopped: ${row.stopReason ?? "the lead moved on"}.`,
      "moved_on",
    );
  if (row.status !== "drafted" || !row.body)
    throw new SendRefused(
      row.status === "needs_edit"
        ? "This follow-up breaks a message rule. Edit it before it goes out."
        : "The agent has not written this follow-up yet.",
      "draft_problems",
    );
  // Earlier follow-ups go first, so the cadence keeps its order.
  const earlier = (await repository.listFollowUps(row.engagementId)).filter(
    (item) =>
      item.stepIndex < row.stepIndex &&
      item.status !== "sent" &&
      item.status !== "stopped",
  );
  if (earlier.length > 0)
    throw new SendRefused(
      `Send or skip follow-up ${earlier[0].stepIndex} first.`,
      "not_sendable",
    );
  const contact = await repository.getContact(engagement.contactId);
  if (contact?.optOut)
    throw new SendRefused("This contact opted out of email.", "opted_out");
  // The last word from HubSpot, right before anything goes out.
  const reason = await deps.stopReason(engagement.id);
  if (reason) {
    await deps.stop(engagement.id, reason);
    throw new SendRefused(`${reason}. Nothing was sent.`, "moved_on");
  }
  const to = (contact?.email ?? "").toLowerCase();
  if (!to)
    throw new SendRefused("The lead has no email address.", "not_sendable");
  const first = await firstTouchOf(repository, engagement.id);
  const body = fillFollowUp(row.body, {
    firstName: await senderFirstName(
      { repository, gmail: deps.gmail, now: deps.now, newId: deps.newId },
      actor,
    ),
    link: await deps.linkFor(engagement.id),
  });
  if (/\[[^\]\n]{1,60}\](?!\()/.test(body))
    throw new SendRefused(
      `Fill in ${body.match(/\[[^\]\n]{1,60}\]/)?.[0]} first.`,
      "placeholder",
    );

  // The caps (D103): per rep, and per company across its leads.
  if (deps.caps) {
    const since = new Date(deps.now().getTime() - 86_400_000).toISOString();
    const recent = (await repository.listOutboxSince(since)).filter(
      (item) =>
        item.status === "sent" && item.idempotencyKey.startsWith("follow_up:"),
    );
    const mine = recent.filter((item) => item.payload.by === actor).length;
    if (mine >= deps.caps.daily_cap)
      throw new SendRefused(
        `You sent ${mine} follow-ups in the last 24 hours, the daily cap. The rest wait until tomorrow.`,
        "not_sendable",
      );
    if (engagement.accountId) {
      let company = 0;
      for (const item of recent) {
        if (!item.engagementId) continue;
        const other = await repository.getEngagement(item.engagementId);
        if (other?.accountId === engagement.accountId) company += 1;
      }
      if (company >= deps.caps.company_daily_cap)
        throw new SendRefused(
          "Someone at this company already got a follow-up in the last 24 hours. Send this one tomorrow.",
          "not_sendable",
        );
    }
  }
  const at = deps.now().toISOString();
  const key = followUpKey(row.id);
  const claimed = await repository.insertOutboxIfAbsent({
    id: deps.newId(),
    kind: "gmail_send",
    idempotencyKey: key,
    engagementId: engagement.id,
    payload: { follow_up_id: row.id, by: actor, to, cc: row.cc },
    status: "pending",
    attempts: 1,
    nextAttemptAt: null,
    providerRef: null,
    lastError: null,
    version: 1,
    createdAt: at,
    updatedAt: at,
  });
  let outbox = await repository.getOutboxByKey(key);
  if (!outbox) throw new SendRefused("Try again.", "in_flight");
  if (!claimed) {
    if (outbox.status === "sent")
      throw new SendRefused("This follow-up already went out.", "already_sent");
    if (outbox.status === "pending")
      throw new SendRefused(
        "An earlier attempt did not finish. Check your Gmail Sent folder before trying again.",
        "in_flight",
      );
    outbox = await repository.updateOutbox(
      outbox.id,
      {
        status: "pending",
        attempts: outbox.attempts + 1,
        lastError: null,
        updatedAt: at,
      },
      outbox.version,
    );
  }
  let sent: { id: string; threadId?: string | null };
  try {
    sent = await deps.gmail.send(actor, {
      from: actor,
      to,
      cc: row.cc && row.cc !== to && row.cc !== actor ? row.cc : null,
      subject: replySubject(first.subject),
      body,
      messageId: newMessageId(outbox.id),
      inReplyTo: first.messageId,
      threadId: first.threadId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Gmail did not answer";
    const refused = error instanceof GmailError;
    await repository.updateOutbox(
      outbox.id,
      {
        status: refused ? "failed" : "pending",
        lastError: message,
        updatedAt: deps.now().toISOString(),
      },
      outbox.version,
    );
    throw new SendRefused(
      refused
        ? message
        : `${message}. Check your Gmail Sent folder before trying again.`,
      "gmail",
      502,
    );
  }
  const done = deps.now().toISOString();
  await repository.updateOutbox(
    outbox.id,
    { status: "sent", providerRef: sent.id, updatedAt: done },
    outbox.version,
  );
  await repository.updateFollowUp(
    row.id,
    { status: "sent", sentAt: done, gmailId: sent.id, body, updatedAt: done },
    row.version,
  );
  await repository.appendEvent({
    id: deps.newId(),
    engagementId: engagement.id,
    correlationId: engagement.id,
    type: "follow_up.sent",
    actor: `user:${actor}`,
    payload: {
      follow_up_id: row.id,
      step: row.stepIndex,
      gmail_id: sent.id,
      to,
      cc: row.cc,
    },
    receiptId: null,
    occurredAt: done,
  });
  return { sent: true, to, step: row.stepIndex, gmailId: sent.id };
}
