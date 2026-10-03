// Approve and send, or approve to Gmail Drafts (D96). The lead's owner sends
// the agent's first touch from their own Gmail. Every guard lives here, so
// the action, the UI, and the tests share one set of rules:
// - only the lead's owner, and only as themselves;
// - only the current draft, and only when it passes every message check;
// - no unfilled placeholders, no lead HubSpot already moved on, no opt-out;
// - one send per lead, ever: the outbox's unique key is written before Gmail
//   is called, so a double click or a retry cannot send twice.
// HubSpot logs the email through the owner's connected inbox; PA writes
// nothing to the CRM.
import { movedOnOfEngagement } from "../core/crm/lifecycle.js";
import type { LintResult } from "../core/drafting/index.js";
import { leadOwnerEmail } from "../core/outreach/delivery.js";
import type { OutboxRecord, PaRepository } from "../core/repo/types.js";
import { GmailError, type GmailClient, type OutgoingEmail } from "./gmail.js";
import { recordFirstTouch } from "./live-pipeline.js";

export type SendMode = "send" | "gmail_draft";

/** States where a first touch can still go out (save-draft's set). */
const SENDABLE = new Set(["awaiting_first_touch", "routed", "attached"]);

/** [calendar link] and friends; a markdown link [text](url) is fine. */
const PLACEHOLDER = /\[[^\]\n]{1,60}\](?!\()/;

/** A pending row older than this is not retried: Gmail may have sent it. */
const PENDING_GRACE_MS = 2 * 60_000;

export class SendRefused extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_found"
      | "not_owner"
      | "not_sendable"
      | "stale_draft"
      | "draft_problems"
      | "placeholder"
      | "moved_on"
      | "opted_out"
      | "already_sent"
      | "in_flight"
      | "gmail",
    readonly statusCode = 409,
  ) {
    super(message);
    this.name = "SendRefused";
  }
}

export interface SendDeps {
  repository: PaRepository;
  gmail: GmailClient;
  now: () => Date;
  newId: () => string;
}

export const sendKey = (engagementId: string) => `first_touch:${engagementId}`;
export const draftKey = (draftId: string) => `gmail_draft:${draftId}`;

/** Checks everything that can be checked before Gmail is called. */
async function prepare(
  deps: SendDeps,
  input: { engagementId: string; draftId: string; actorEmail: string },
) {
  const { repository } = deps;
  const engagement = await repository.getEngagement(input.engagementId);
  if (!engagement) throw new SendRefused("Lead not found", "not_found", 404);
  const owner = await leadOwnerEmail(repository, engagement);
  const actor = input.actorEmail.toLowerCase();
  if (!owner || owner !== actor)
    throw new SendRefused(
      owner
        ? `Only ${owner} can send this. It goes out from the owner's own Gmail.`
        : "This lead has no owner yet, so there is no Gmail to send it from.",
      "not_owner",
      403,
    );
  if (engagement.firstTouchAt)
    throw new SendRefused(
      "This lead was already contacted, so PA will not send another first touch.",
      "already_sent",
    );
  if (!SENDABLE.has(engagement.state))
    throw new SendRefused(
      `This lead is ${engagement.state.replace(/_/g, " ")}, so it gets no first touch.`,
      "not_sendable",
    );
  const drafts = await repository.listDrafts(engagement.id);
  const draft = drafts[drafts.length - 1];
  if (!draft || draft.id !== input.draftId)
    throw new SendRefused(
      "A newer draft replaced this one. Reload the lead and check it first.",
      "stale_draft",
    );
  const lint = (draft.lint ?? null) as
    | (LintResult & { route?: { cc?: string | null } | null })
    | null;
  if (draft.status !== "proposed" || (lint && !lint.ok))
    throw new SendRefused(
      "This draft breaks a message rule. Rewrite it before it goes out.",
      "draft_problems",
    );
  if (PLACEHOLDER.test(draft.subject) || PLACEHOLDER.test(draft.body))
    throw new SendRefused(
      `Fill in ${(draft.body.match(PLACEHOLDER) ?? draft.subject.match(PLACEHOLDER))?.[0]} first. Add the meeting link on the lead, then rewrite the reply.`,
      "placeholder",
    );
  const movedOn = await movedOnOfEngagement(repository, engagement.id);
  if (movedOn)
    throw new SendRefused(
      `HubSpot already moved this lead on (${movedOn.reason.toLowerCase()}), so PA will not email it.`,
      "moved_on",
    );
  const contact = await repository.getContact(engagement.contactId);
  if (contact?.optOut)
    throw new SendRefused("This contact opted out of email.", "opted_out", 409);
  const submissions = await repository.listSubmissionsForEngagement(
    engagement.id,
  );
  const to = (
    contact?.email ??
    submissions[submissions.length - 1]?.email ??
    ""
  ).toLowerCase();
  if (!to)
    throw new SendRefused("The lead has no email address.", "not_sendable");
  const cc = lint?.route?.cc?.toLowerCase() ?? null;
  const email: OutgoingEmail = {
    from: actor,
    to,
    cc: cc && cc !== to && cc !== actor ? cc : null,
    subject: draft.subject,
    body: draft.body,
  };
  return { engagement, draft, email, owner: actor, submissions };
}

/** Claims the outbox key, or says why this cannot go out now. */
async function claim(deps: SendDeps, row: OutboxRecord): Promise<OutboxRecord> {
  const { repository } = deps;
  if (await repository.insertOutboxIfAbsent(row)) return row;
  const existing = await repository.getOutboxByKey(row.idempotencyKey);
  if (!existing) throw new SendRefused("Try again.", "in_flight");
  if (existing.status === "sent")
    throw new SendRefused(
      row.kind === "gmail_send"
        ? "Already sent from Gmail. PA sends one first touch per lead."
        : "Already in your Gmail Drafts.",
      "already_sent",
    );
  const age = deps.now().getTime() - Date.parse(existing.updatedAt);
  if (existing.status === "pending")
    throw new SendRefused(
      age < PENDING_GRACE_MS
        ? "Already going out. Give it a moment."
        : "An earlier attempt did not finish. Check your Gmail Sent folder before trying again.",
      "in_flight",
    );
  // Gmail refused last time, so nothing went out: try again on the same key.
  return repository.updateOutbox(
    existing.id,
    {
      status: "pending",
      attempts: existing.attempts + 1,
      payload: row.payload,
      lastError: null,
      updatedAt: row.updatedAt,
    },
    existing.version,
  );
}

export async function approveFirstTouch(
  deps: SendDeps,
  input: {
    engagementId: string;
    draftId: string;
    actorEmail: string;
    mode: SendMode;
  },
) {
  const { repository } = deps;
  const prepared = await prepare(deps, input);
  const { engagement, draft, email } = prepared;
  // A send already claimed for this lead blocks a Drafts copy too. A second
  // send is caught by its own key in claim().
  const sendRow =
    input.mode === "gmail_draft"
      ? await repository.getOutboxByKey(sendKey(engagement.id))
      : null;
  if (sendRow && sendRow.status !== "failed")
    throw new SendRefused(
      sendRow.status === "sent"
        ? "This lead's first touch already went out from Gmail."
        : "This lead's first touch is already going out from Gmail.",
      sendRow.status === "sent" ? "already_sent" : "in_flight",
    );
  const at = deps.now().toISOString();
  const kind = input.mode === "send" ? "gmail_send" : "gmail_draft";
  let row = await claim(deps, {
    id: deps.newId(),
    kind,
    idempotencyKey:
      input.mode === "send" ? sendKey(engagement.id) : draftKey(draft.id),
    engagementId: engagement.id,
    payload: {
      draft_id: draft.id,
      by: prepared.owner,
      to: email.to,
      cc: email.cc,
      subject: email.subject,
    },
    status: "pending",
    attempts: 1,
    nextAttemptAt: null,
    providerRef: null,
    lastError: null,
    version: 1,
    createdAt: at,
    updatedAt: at,
  });
  let providerId: string;
  try {
    providerId = (
      input.mode === "send"
        ? await deps.gmail.send(prepared.owner, email)
        : await deps.gmail.saveDraft(prepared.owner, email)
    ).id;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Gmail did not answer";
    // A timeout may still have sent: keep it pending so it is never retried
    // blind. Anything Gmail refused outright is safe to retry.
    const refused = error instanceof GmailError;
    await repository.updateOutbox(
      row.id,
      {
        status: refused ? "failed" : "pending",
        lastError: message,
        updatedAt: deps.now().toISOString(),
      },
      row.version,
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
  row = await repository.updateOutbox(
    row.id,
    { status: "sent", providerRef: providerId, updatedAt: done },
    row.version,
  );
  const receiptId = deps.newId();
  await repository.insertReceipt({
    id: receiptId,
    kind: input.mode === "send" ? "send" : "gmail_draft",
    engagementId: engagement.id,
    submissionId: draft.submissionId,
    playbookReleaseId: engagement.playbookReleaseId,
    entryVersions: [],
    ruleResults: { approved: true, mode: input.mode },
    inputs: {
      draft_id: draft.id,
      outbox_id: row.id,
      gmail_id: providerId,
      from: email.from,
      to: email.to,
      cc: email.cc,
    },
    agentRunId: null,
    toolCalls: null,
    model: null,
    createdAt: done,
  });
  const actor = `user:${prepared.owner}`;
  if (input.mode === "send") {
    // The board shows it at once (D75's sent card); HubSpot's copy, logged
    // by the owner's inbox sync, is matched later by the first-touch check.
    await repository.appendEvent({
      id: deps.newId(),
      engagementId: engagement.id,
      correlationId: engagement.id,
      type: "first_touch.email",
      actor,
      payload: {
        email_id: `gmail:${providerId}`,
        kind: "sent_from_pa",
        sent_at: done,
        subject: email.subject,
        from: email.from,
        to: email.to,
        preview: email.body.replace(/\s+/g, " ").trim().slice(0, 300),
      },
      receiptId,
      occurredAt: done,
    });
    await recordFirstTouch(
      engagement.id,
      { at: done, title: email.subject, from: email.from },
      repository,
      actor,
    );
  } else {
    await repository.appendEvent({
      id: deps.newId(),
      engagementId: engagement.id,
      correlationId: engagement.id,
      type: "draft.approved",
      actor,
      payload: { draft_id: draft.id, gmail_draft_id: providerId },
      receiptId,
      occurredAt: done,
    });
  }
  return {
    mode: input.mode,
    sent: input.mode === "send",
    gmailId: providerId,
    to: email.to,
    cc: email.cc,
  };
}
