// Follow-up cadences (D101). After a lead's first touch, its route's cadence
// from the playbook (rule.follow_ups.cadence) becomes scheduled follow-ups.
// The agent writes each one shortly before it is due; the owner reviews and
// sends it from their Gmail, as a reply in the first touch's thread. Every
// follow-up stops when the lead replies, books a meeting, opts out, or
// HubSpot moves them on. PA only reads HubSpot.
import { cadenceFor, type CadenceParams } from "../../shared/cadence.js";
import { fetchContactHistory } from "../core/crm/history.js";
import { movedOnOfEngagement } from "../core/crm/lifecycle.js";
import { routeForEngagement } from "../core/lead-route/engagement.js";
import { draftRouteOf } from "../core/lead-route/index.js";
import type { PlaybookRelease } from "../core/playbook/schema.js";
import type {
  EngagementRecord,
  FollowUpRecord,
  PaRepository,
} from "../core/repo/types.js";
import { hubspotFetch } from "./live-pipeline.js";
import { activeRelease, newId, now, repo } from "./pa-context.js";

export const ENROLLED_EVENT = "follow_ups.enrolled";
export const STOPPED_EVENT = "follow_ups.stopped";
const CHECKED_EVENT = "follow_ups.checked";

/** Leads are enrolled when their first touch is this recent (not old history). */
const ENROLL_WINDOW_MS = 48 * 60 * 60 * 1000;
/** The agent writes a follow-up this long before it is due. */
export const DRAFT_AHEAD_MS = 18 * 60 * 60 * 1000;
/** How often a lead with open follow-ups is checked for a reply in HubSpot. */
const REPLY_CHECK_MS = 30 * 60 * 1000;

export function cadenceParams(release: PlaybookRelease): CadenceParams | null {
  const entry = release.entries.find(
    (item) =>
      item.id === "rule.follow_ups.cadence" && item.status !== "retired",
  );
  return (entry?.params ?? null) as CadenceParams | null;
}

/** The day's follow-up, moved off a weekend to Monday at the same time. */
export function dueDate(firstTouchAt: string, day: number): string {
  const due = new Date(Date.parse(firstTouchAt) + day * 86_400_000);
  const weekday = due.getUTCDay();
  if (weekday === 6) due.setUTCDate(due.getUTCDate() + 2);
  if (weekday === 0) due.setUTCDate(due.getUTCDate() + 1);
  return due.toISOString();
}

/** The lead's HubSpot contact id, from the inbox row it came in on. */
async function contactIdOf(repository: PaRepository, engagementId: string) {
  for (const submission of await repository.listSubmissionsForEngagement(
    engagementId,
  )) {
    const inbox = await repository.getInbox(submission.inboxId);
    const id = inbox?.payload.crm_contact_id;
    if (typeof id === "string" && id) return id;
  }
  return null;
}

/** A reply or a meeting in HubSpot since the first touch, if any. */
export async function replyOrMeetingSince(
  repository: PaRepository,
  engagement: EngagementRecord,
): Promise<string | null> {
  const since = engagement.firstTouchAt;
  if (!since) return null;
  const contactId = await contactIdOf(repository, engagement.id);
  if (!contactId) return null;
  const history = await fetchContactHistory(hubspotFetch, contactId, {
    perType: 10,
  });
  const after = (at: string | null) => Boolean(at && at > since);
  if (
    history.items.some(
      (item) =>
        item.kind === "email" && item.direction === "inbound" && after(item.at),
    )
  )
    return "They replied";
  if (history.items.some((item) => item.kind === "meeting" && after(item.at)))
    return "A meeting was booked";
  return null;
}

/** Stops a lead's open follow-ups, once, with the reason. */
export async function stopFollowUps(
  repository: PaRepository,
  engagementId: string,
  reason: string,
) {
  const open = (await repository.listFollowUps(engagementId)).filter((row) =>
    ["scheduled", "drafted", "needs_edit"].includes(row.status),
  );
  if (open.length === 0) return 0;
  const at = now().toISOString();
  for (const row of open)
    await repository.updateFollowUp(
      row.id,
      { status: "stopped", stopReason: reason, updatedAt: at },
      row.version,
    );
  await repository.appendEvent({
    id: newId(),
    engagementId,
    correlationId: engagementId,
    type: STOPPED_EVENT,
    actor: "system:follow-ups",
    payload: { reason, stopped: open.length },
    receiptId: null,
    occurredAt: at,
  });
  return open.length;
}

/** Gives every lead whose first touch just went out its route's cadence. */
export async function enrollFollowUps(budgetMs = 8_000) {
  const repository = repo();
  const started = Date.now();
  const cutoff = new Date(now().getTime() - ENROLL_WINDOW_MS).toISOString();
  const candidates = (await repository.listEngagements()).filter(
    (item) => item.firstTouchAt && item.firstTouchAt >= cutoff,
  );
  if (candidates.length === 0) return { enrolled: 0 };
  const release = await activeRelease(repository);
  const params = cadenceParams(release);
  let enrolled = 0;
  for (const engagement of candidates) {
    if (Date.now() - started > budgetMs) break;
    const events = await repository.listEvents(engagement.id);
    if (events.some((item) => item.type === ENROLLED_EVENT)) continue;
    const mark = (payload: Record<string, unknown>) =>
      repository.appendEvent({
        id: newId(),
        engagementId: engagement.id,
        correlationId: engagement.id,
        type: ENROLLED_EVENT,
        actor: "system:follow-ups",
        payload,
        receiptId: null,
        occurredAt: now().toISOString(),
      });
    if (await movedOnOfEngagement(repository, engagement.id)) {
      await mark({ steps: 0, reason: "moved_on" });
      continue;
    }
    const route = await routeForEngagement(repository, release, engagement);
    const cadence = cadenceFor(params, route.route);
    if (!cadence) {
      await mark({ steps: 0, route: route.route, reason: "no_cadence" });
      continue;
    }
    const draftRoute = draftRouteOf(route);
    const cc =
      route.route === "route_to_ae" && cadence.cc_ae !== false
        ? draftRoute.cc
        : null;
    const at = now().toISOString();
    const rows: FollowUpRecord[] = cadence.steps.map((step, index) => ({
      id: newId(),
      engagementId: engagement.id,
      route: route.route,
      stepIndex: index + 1,
      day: step.day,
      purpose: step.purpose,
      dueAt: dueDate(engagement.firstTouchAt!, step.day),
      status: "scheduled",
      subject: null,
      body: null,
      lint: null,
      cc,
      stopReason: null,
      sentAt: null,
      gmailId: null,
      editedBy: null,
      version: 1,
      createdAt: at,
      updatedAt: at,
    }));
    await repository.insertFollowUps(rows);
    await mark({ steps: rows.length, route: route.route });
    enrolled += 1;
  }
  return { enrolled };
}

/**
 * Stops follow-ups on leads that replied, booked, opted out, or moved on.
 * HubSpot is read for a lead at most every 30 minutes; the send step checks
 * again right before an email goes out.
 */
export async function checkFollowUps(budgetMs = 10_000, limit = 8) {
  const repository = repo();
  const started = Date.now();
  const byLead = new Map<string, FollowUpRecord[]>();
  for (const row of await repository.listOpenFollowUps())
    byLead.set(row.engagementId, [
      ...(byLead.get(row.engagementId) ?? []),
      row,
    ]);
  let checked = 0;
  let stopped = 0;
  for (const engagementId of byLead.keys()) {
    if (checked >= limit || Date.now() - started > budgetMs) break;
    const engagement = await repository.getEngagement(engagementId);
    if (!engagement) continue;
    const reason = await stopReasonOf(repository, engagement, {
      hubspotEveryMs: REPLY_CHECK_MS,
    });
    if (reason === "skipped") continue;
    checked += 1;
    if (reason)
      stopped += await stopFollowUps(repository, engagementId, reason);
  }
  return { checked, stopped };
}

/**
 * Why a lead's follow-ups must stop now, or null. "skipped" when HubSpot was
 * read for it recently and nothing local says stop.
 */
export async function stopReasonOf(
  repository: PaRepository,
  engagement: EngagementRecord,
  opts: { hubspotEveryMs?: number } = {},
): Promise<string | null | "skipped"> {
  const movedOn = await movedOnOfEngagement(repository, engagement.id);
  if (movedOn) return movedOn.reason;
  const contact = await repository.getContact(engagement.contactId);
  if (contact?.optOut) return "They opted out of email";
  if (opts.hubspotEveryMs) {
    const last = (await repository.listEvents(engagement.id))
      .filter((item) => item.type === CHECKED_EVENT)
      .slice(-1)[0];
    if (
      last &&
      now().getTime() - Date.parse(last.occurredAt) < opts.hubspotEveryMs
    )
      return "skipped";
  }
  const found = await replyOrMeetingSince(repository, engagement);
  await repository.appendEvent({
    id: newId(),
    engagementId: engagement.id,
    correlationId: engagement.id,
    type: CHECKED_EVENT,
    actor: "system:follow-ups",
    payload: { found },
    receiptId: null,
    occurredAt: now().toISOString(),
  });
  return found;
}

export interface FollowUpWorkItem {
  engagementId: string;
  step: "follow_up";
  followUpId: string;
  lead: string;
  stepIndex: number;
  purpose: string;
  dueAt: string;
}

/** Follow-ups the agent owes: scheduled ones due within the next 18 hours. */
export async function followUpWork(
  repository: PaRepository,
  limit = 10,
): Promise<FollowUpWorkItem[]> {
  const horizon = new Date(now().getTime() + DRAFT_AHEAD_MS).toISOString();
  const work: FollowUpWorkItem[] = [];
  for (const row of await repository.listOpenFollowUps()) {
    if (work.length >= limit) break;
    if (row.status !== "scheduled" || row.dueAt > horizon) continue;
    const engagement = await repository.getEngagement(row.engagementId);
    const contact = engagement
      ? await repository.getContact(engagement.contactId)
      : null;
    work.push({
      engagementId: row.engagementId,
      step: "follow_up",
      followUpId: row.id,
      lead: contact?.name ?? contact?.email ?? row.engagementId,
      stepIndex: row.stepIndex,
      purpose: row.purpose,
      dueAt: row.dueAt,
    });
  }
  return work;
}

/** The first touch as sent: subject, body, and the thread to reply in. */
export async function firstTouchOf(
  repository: PaRepository,
  engagementId: string,
) {
  const events = await repository.listEvents(engagementId);
  const sent = [...events]
    .reverse()
    .find((item) => item.type === "first_touch.email");
  const text = (key: string) =>
    typeof sent?.payload[key] === "string"
      ? (sent.payload[key] as string)
      : null;
  let body = text("preview");
  // Sent from PA: the full draft that went out.
  if (sent?.payload.kind === "sent_from_pa") {
    const outbox = (await repository.listOutbox(engagementId)).find(
      (row) => row.kind === "gmail_send" && row.status === "sent",
    );
    const draftId = outbox?.payload.draft_id;
    const draft = (await repository.listDrafts(engagementId)).find(
      (item) => item.id === draftId,
    );
    if (draft?.body) body = draft.body;
  }
  return {
    subject: text("subject"),
    body,
    messageId: text("message_id"),
    threadId: text("thread_id"),
  };
}

export const replySubject = (subject: string | null) =>
  subject ? `Re: ${subject.replace(/^(re:\s*)+/i, "")}` : "Following up";

/** The meeting link the lead's route carries now, for [meeting link]. */
export async function routeLinkOf(
  repository: PaRepository,
  engagementId: string,
): Promise<string | null> {
  const engagement = await repository.getEngagement(engagementId);
  if (!engagement) return null;
  const release = await activeRelease(repository);
  return draftRouteOf(await routeForEngagement(repository, release, engagement))
    .link;
}

/** The emails the lead already got: the first touch and sent follow-ups. */
export async function earlierEmails(
  repository: PaRepository,
  row: FollowUpRecord,
): Promise<string[]> {
  const first = await firstTouchOf(repository, row.engagementId);
  const sent = (await repository.listFollowUps(row.engagementId))
    .filter(
      (item) =>
        item.stepIndex < row.stepIndex &&
        item.body &&
        (item.status === "sent" ||
          item.status === "drafted" ||
          item.status === "needs_edit"),
    )
    .map((item) => item.body as string);
  return [first.body ?? "", ...sent].filter(Boolean);
}
