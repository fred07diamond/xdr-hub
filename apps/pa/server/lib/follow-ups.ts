// Follow-up cadences (D101). After a lead's first touch, its route's cadence
// from the playbook (rule.follow_ups.cadence) becomes scheduled follow-ups.
// The agent writes each one shortly before it is due; the owner reviews and
// sends it from their Gmail, as a reply in the first touch's thread. Every
// follow-up stops when the lead replies, books a meeting, opts out, or
// HubSpot moves them on. PA only reads HubSpot.
import {
  CADENCE_DEFAULTS,
  cadenceFor,
  cadenceSettings,
  type CadenceParams,
} from "../../shared/cadence.js";
import { wallTimeToInstant, zonedParts } from "../core/clocks/index.js";
import { fetchContactHistory } from "../core/crm/history.js";
import { movedOnOfEngagement } from "../core/crm/lifecycle.js";
import { routeForEngagement } from "../core/lead-route/engagement.js";
import { draftRouteOf } from "../core/lead-route/index.js";
import {
  defaultReturn,
  signalSince,
  type ReplySignal,
} from "../core/outreach/replies.js";
import { leadTimezone } from "../core/outreach/timezone.js";
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
const REPLY_CHECK_MS = 15 * 60 * 1000;

export function cadenceParams(release: PlaybookRelease): CadenceParams | null {
  const entry = release.entries.find(
    (item) =>
      item.id === "rule.follow_ups.cadence" && item.status !== "retired",
  );
  return (entry?.params ?? null) as CadenceParams | null;
}

/**
 * When a follow-up comes due (D103): `day` days after the first touch, on a
 * business day in the lead's time zone, at the start of the send window.
 */
export function dueDate(
  firstTouchAt: string,
  day: number,
  timezone = FALLBACK_ZONE,
  windowStart = CADENCE_DEFAULTS.window_start,
): string {
  const local = zonedParts(new Date(firstTouchAt), timezone);
  const date = new Date(Date.UTC(local.year, local.month - 1, local.day + day));
  // Weekends move to Monday.
  if (date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 2);
  if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
  const [hour, minute] = windowStart.split(":").map(Number);
  return wallTimeToInstant(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    hour,
    minute,
    timezone,
  ).toISOString();
}

/** Central US when nothing says where the lead is. */
const FALLBACK_ZONE = "America/Chicago";

/** The inbox row the lead came in on: its contact id, time zone, country. */
async function inboxOf(repository: PaRepository, engagementId: string) {
  for (const submission of await repository.listSubmissionsForEngagement(
    engagementId,
  )) {
    const inbox = await repository.getInbox(submission.inboxId);
    if (inbox) return inbox.payload;
  }
  return null;
}

async function contactIdOf(repository: PaRepository, engagementId: string) {
  const id = (await inboxOf(repository, engagementId))?.crm_contact_id;
  return typeof id === "string" && id ? id : null;
}

/** The lead's time zone (D103): HubSpot's, else their country's, else Central. */
export async function leadZoneOf(
  repository: PaRepository,
  engagementId: string,
): Promise<{ zone: string; known: boolean }> {
  const payload = await inboxOf(repository, engagementId);
  const zone = leadTimezone({
    hubspotTimezone:
      typeof payload?.timezone === "string" ? payload.timezone : null,
    country: typeof payload?.country === "string" ? payload.country : null,
  });
  return zone ? { zone, known: true } : { zone: FALLBACK_ZONE, known: false };
}

export const PAUSED_EVENT = "follow_ups.paused";

/**
 * What HubSpot shows since the first touch (D103): a bounce, a meeting, a
 * real reply, or an out-of-office not handled yet. Null when nothing.
 */
export async function inspectSince(
  repository: PaRepository,
  engagement: EngagementRecord,
): Promise<ReplySignal | null> {
  const since = engagement.firstTouchAt;
  if (!since) return null;
  const contactId = await contactIdOf(repository, engagement.id);
  if (!contactId) return null;
  const history = await fetchContactHistory(hubspotFetch, contactId, {
    perType: 10,
  });
  const handled = new Set(
    (await repository.listEvents(engagement.id))
      .filter(
        (item) =>
          item.type === PAUSED_EVENT ||
          (item.type === LABELED_EVENT &&
            item.payload.label === "out_of_office"),
      )
      .map((item) => String(item.payload.email_id ?? "")),
  );
  return signalSince({
    since,
    emails: history.items
      .filter((item) => item.kind === "email")
      .map((item) => ({
        id: item.id,
        at: item.at,
        title: item.title,
        preview: item.preview,
        from: item.from,
        direction: item.direction,
        status: item.status,
      })),
    meetings: history.items.filter((item) => item.kind === "meeting"),
    handled,
    now: now(),
  });
}

export const LABELED_EVENT = "reply.labeled";

/** Stops a lead's open follow-ups, once, with the reason. */
export async function stopFollowUps(
  repository: PaRepository,
  engagementId: string,
  reason: string,
  detail: Record<string, unknown> = {},
) {
  const open = (await repository.listFollowUps(engagementId)).filter((row) =>
    ["scheduled", "drafted", "needs_edit", "approved"].includes(row.status),
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
    payload: { reason, stopped: open.length, ...detail },
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
    // Per step (D104): the step's own cc setting, else the route's.
    const ccFor = (step: { cc_ae?: boolean }) =>
      route.route === "route_to_ae" && (step.cc_ae ?? cadence.cc_ae) !== false
        ? draftRoute.cc
        : null;
    const at = now().toISOString();
    // Due in the lead's own business hours (D103).
    const { zone } = await leadZoneOf(repository, engagement.id);
    const windowStart = cadenceSettings(params).window_start;
    const rows: FollowUpRecord[] = cadence.steps.map((step, index) => ({
      id: newId(),
      engagementId: engagement.id,
      route: route.route,
      stepIndex: index + 1,
      day: step.day,
      purpose: step.purpose,
      dueAt: dueDate(engagement.firstTouchAt!, step.day, zone, windowStart),
      status: "scheduled",
      subject: null,
      body: null,
      lint: null,
      cc: ccFor(step),
      thread: step.thread ?? "reply",
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
 * Checks leads with open follow-ups (D101, D103): stops them on a reply, a
 * meeting, a bounce, an opt-out, or a stage change, and pauses them on an
 * out-of-office. HubSpot is read for a lead at most every 30 minutes; the
 * send step checks again right before an email goes out.
 */
export async function checkFollowUps(budgetMs = 10_000, limit = 8) {
  const repository = repo();
  const started = Date.now();
  const leads = new Set(
    (await repository.listOpenFollowUps()).map((row) => row.engagementId),
  );
  let checked = 0;
  let stopped = 0;
  let paused = 0;
  for (const engagementId of leads) {
    if (checked >= limit || Date.now() - started > budgetMs) break;
    const engagement = await repository.getEngagement(engagementId);
    if (!engagement) continue;
    const check = await checkLead(repository, engagement, {
      hubspotEveryMs: REPLY_CHECK_MS,
    });
    if (check === "skipped") continue;
    checked += 1;
    const applied = await applyCheck(repository, engagement, check);
    if (check.action === "stop") stopped += applied;
    if (check.action === "pause") paused += 1;
  }
  return { checked, stopped, paused };
}

export type CadenceCheck =
  | { action: "none" }
  | {
      action: "stop";
      reason: string;
      kind: "moved_on" | "opted_out" | "reply" | "meeting" | "bounce";
      emailId?: string | null;
      preview?: string | null;
    }
  | { action: "pause"; until: string; emailId: string };

/**
 * What a lead's follow-ups should do now. "skipped" when HubSpot was read
 * for it recently and nothing local says stop.
 */
export async function checkLead(
  repository: PaRepository,
  engagement: EngagementRecord,
  opts: { hubspotEveryMs?: number } = {},
): Promise<CadenceCheck | "skipped"> {
  const movedOn = await movedOnOfEngagement(repository, engagement.id);
  if (movedOn)
    return { action: "stop", reason: movedOn.reason, kind: "moved_on" };
  const contact = await repository.getContact(engagement.contactId);
  if (contact?.optOut)
    return {
      action: "stop",
      reason: "They opted out of email",
      kind: "opted_out",
    };
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
  const signal = await inspectSince(repository, engagement);
  await repository.appendEvent({
    id: newId(),
    engagementId: engagement.id,
    correlationId: engagement.id,
    type: CHECKED_EVENT,
    actor: "system:follow-ups",
    payload: { found: signal?.kind ?? null },
    receiptId: null,
    occurredAt: now().toISOString(),
  });
  if (!signal) return { action: "none" };
  switch (signal.kind) {
    case "bounce":
      return {
        action: "stop",
        reason: "The email bounced",
        kind: "bounce",
        emailId: signal.email.id,
      };
    case "meeting":
      return {
        action: "stop",
        reason: "A meeting was booked",
        kind: "meeting",
      };
    case "reply":
      return {
        action: "stop",
        reason: "They replied",
        kind: "reply",
        emailId: signal.email.id,
        preview: (signal.email.preview ?? "").slice(0, 300),
      };
    case "out_of_office":
      return {
        action: "pause",
        until: signal.until.toISOString(),
        emailId: signal.email.id,
      };
  }
}

/** Applies a check; returns how many follow-ups it stopped. */
export async function applyCheck(
  repository: PaRepository,
  engagement: EngagementRecord,
  check: CadenceCheck,
): Promise<number> {
  if (check.action === "none") return 0;
  if (check.action === "pause") {
    await pauseFollowUps(repository, engagement.id, check.until, check.emailId);
    return 0;
  }
  let stopped = await stopFollowUps(repository, engagement.id, check.reason, {
    kind: check.kind,
    email_id: check.emailId ?? null,
    preview: check.preview ?? null,
  });
  // Anyone at the company replying or booking stops the whole company (D103).
  if (
    (check.kind === "reply" || check.kind === "meeting") &&
    engagement.accountId
  )
    stopped += await stopCompany(repository, engagement, check.kind);
  return stopped;
}

async function stopCompany(
  repository: PaRepository,
  engagement: EngagementRecord,
  kind: "reply" | "meeting",
) {
  const leads = new Set(
    (await repository.listOpenFollowUps())
      .map((row) => row.engagementId)
      .filter((id) => id !== engagement.id),
  );
  if (leads.size === 0) return 0;
  const contact = await repository.getContact(engagement.contactId);
  const who = contact?.name ?? contact?.email ?? "someone";
  let stopped = 0;
  for (const id of leads) {
    const other = await repository.getEngagement(id);
    if (!other || other.accountId !== engagement.accountId) continue;
    stopped += await stopFollowUps(
      repository,
      id,
      kind === "reply"
        ? `${who} at the same company replied`
        : `${who} at the same company booked a meeting`,
      { kind: "company", from_engagement: engagement.id },
    );
  }
  return stopped;
}

/** Moves open follow-ups to after an out-of-office return date (D103). */
export async function pauseFollowUps(
  repository: PaRepository,
  engagementId: string,
  until: string,
  emailId: string,
) {
  const open = (await repository.listFollowUps(engagementId)).filter((row) =>
    ["scheduled", "drafted", "needs_edit", "approved"].includes(row.status),
  );
  const first = open[0];
  const at = now().toISOString();
  if (first && first.dueAt < until) {
    // Keep the gaps between steps; the next one comes due the day they are back.
    const shift = Date.parse(until) - Date.parse(first.dueAt);
    for (const row of open)
      await repository.updateFollowUp(
        row.id,
        {
          dueAt: new Date(Date.parse(row.dueAt) + shift).toISOString(),
          updatedAt: at,
        },
        row.version,
      );
  }
  await repository.appendEvent({
    id: newId(),
    engagementId,
    correlationId: engagementId,
    type: PAUSED_EVENT,
    actor: "system:follow-ups",
    payload: { until, email_id: emailId, moved: open.length },
    receiptId: null,
    occurredAt: at,
  });
}

/** For the send step: the reason it must not go out now, applied, or null. */
export async function blockerNow(
  repository: PaRepository,
  engagementId: string,
): Promise<string | null> {
  const engagement = await repository.getEngagement(engagementId);
  if (!engagement) return "The lead is gone";
  const check = await checkLead(repository, engagement);
  if (check === "skipped" || check.action === "none") return null;
  await applyCheck(repository, engagement, check);
  return check.action === "pause"
    ? `They are out of office until ${new Date(check.until).toLocaleDateString("en-US", { month: "short", day: "numeric" })}, so the follow-ups moved to after that`
    : check.reason;
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

export const REPLY_LABELS = [
  "interested",
  "not_interested",
  "referral",
  "unsubscribe",
  "out_of_office",
  "other",
] as const;
export type ReplyLabel = (typeof REPLY_LABELS)[number];

/** Replies that stopped a cadence and have no label yet (the agent's work). */
export async function unlabeledReplies(
  repository: PaRepository,
  limit = 10,
): Promise<Array<{ engagementId: string; emailId: string; lead: string }>> {
  const since = new Date(now().getTime() - 30 * 86_400_000).toISOString();
  const leads = new Set(
    (await repository.listFollowUpsSince(since))
      .filter(
        (row) => row.status === "stopped" && row.stopReason === "They replied",
      )
      .map((row) => row.engagementId),
  );
  const work = [];
  for (const engagementId of leads) {
    if (work.length >= limit) break;
    const events = await repository.listEvents(engagementId);
    const labeled = new Set(
      events
        .filter((item) => item.type === LABELED_EVENT)
        .map((item) => String(item.payload.email_id ?? "")),
    );
    const stop = events.find(
      (item) =>
        item.type === STOPPED_EVENT &&
        item.payload.kind === "reply" &&
        typeof item.payload.email_id === "string" &&
        !labeled.has(item.payload.email_id as string),
    );
    if (!stop) continue;
    const engagement = await repository.getEngagement(engagementId);
    const contact = engagement
      ? await repository.getContact(engagement.contactId)
      : null;
    work.push({
      engagementId,
      emailId: stop.payload.email_id as string,
      lead: contact?.name ?? contact?.email ?? engagementId,
    });
  }
  return work;
}

/**
 * Labels a reply (D103). Unsubscribe opts the contact out in PA. Out of
 * office (a misread reply) puts the follow-ups back, after the return date,
 * including any it stopped at the same company.
 */
export async function labelReply(
  repository: PaRepository,
  input: {
    engagementId: string;
    emailId: string;
    label: ReplyLabel;
    summary: string | null;
    returnDate: string | null;
    actor: string;
  },
) {
  const engagement = await repository.getEngagement(input.engagementId);
  if (!engagement) throw new Error("Lead not found");
  const at = now().toISOString();
  let resumed = 0;
  if (input.label === "unsubscribe") {
    const contact = await repository.getContact(engagement.contactId);
    if (contact && !contact.optOut)
      await repository.updateContact(
        contact.id,
        { optOut: true, updatedAt: at },
        contact.version,
      );
  }
  if (input.label === "out_of_office") {
    const until =
      input.returnDate && !Number.isNaN(Date.parse(input.returnDate))
        ? new Date(`${input.returnDate.slice(0, 10)}T16:00:00.000Z`)
        : defaultReturn(now());
    const restore = async (
      engagementId: string,
      reasons: (r: string) => boolean,
    ) => {
      const rows = (await repository.listFollowUps(engagementId)).filter(
        (row) => row.status === "stopped" && reasons(row.stopReason ?? ""),
      );
      for (const row of rows) {
        const lint = (row.lint ?? {}) as { ok?: boolean };
        await repository.updateFollowUp(
          row.id,
          {
            status: row.body
              ? lint.ok === false
                ? "needs_edit"
                : "drafted"
              : "scheduled",
            stopReason: null,
            updatedAt: at,
          },
          row.version,
        );
        resumed += 1;
      }
      if (rows.length > 0)
        await pauseFollowUps(
          repository,
          engagementId,
          until.toISOString(),
          input.emailId,
        );
    };
    await restore(engagement.id, (reason) => reason === "They replied");
    // Leads at the same company this reply stopped.
    for (const id of new Set(
      (
        await repository.listFollowUpsSince(
          new Date(now().getTime() - 60 * 86_400_000).toISOString(),
        )
      ).map((row) => row.engagementId),
    )) {
      if (id === engagement.id) continue;
      const stopped = (await repository.listEvents(id)).some(
        (item) =>
          item.type === STOPPED_EVENT &&
          item.payload.from_engagement === engagement.id,
      );
      if (stopped)
        await restore(id, (reason) =>
          /at the same company (replied|booked)/.test(reason),
        );
    }
  }
  await repository.appendEvent({
    id: newId(),
    engagementId: engagement.id,
    correlationId: engagement.id,
    type: LABELED_EVENT,
    actor: input.actor,
    payload: {
      email_id: input.emailId,
      label: input.label,
      summary: input.summary,
      return_date: input.returnDate,
      resumed,
    },
    receiptId: null,
    occurredAt: at,
  });
  return { label: input.label, resumed };
}
