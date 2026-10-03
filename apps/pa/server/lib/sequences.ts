// Named sequences (D105): starting sequences, previewing one for a lead,
// enrolling (manual, after the first touch), and sending a template
// sequence's approved emails on their day.
import { cadenceFor, cadenceSettings } from "../../shared/cadence.js";
import {
  fillTemplate,
  orderedSteps,
  UNFILLED_TOKEN,
  type SequenceInput,
} from "../../shared/sequences.js";
import { zonedParts } from "../core/clocks/index.js";
import { movedOnOfEngagement } from "../core/crm/lifecycle.js";
import { lintFollowUp } from "../core/drafting/follow-up.js";
import { routeForEngagement } from "../core/lead-route/engagement.js";
import { draftRouteOf } from "../core/lead-route/index.js";
import { leadOwnerEmail } from "../core/outreach/delivery.js";
import type {
  EngagementRecord,
  FollowUpRecord,
  PaRepository,
  SequenceRecord,
} from "../core/repo/types.js";
import { SendRefused } from "./first-touch-send.js";
import { sendFollowUp } from "./follow-up-send.js";
import {
  ENROLLED_EVENT,
  blockerNow,
  cadenceParams,
  dueDate,
  firstTouchOf,
  leadZoneOf,
  replySubject,
  routeLinkOf,
  stopFollowUps,
} from "./follow-ups.js";
import { gmailClient } from "./gmail.js";
import { activeRelease, newId, now, repo } from "./pa-context.js";

const ROUTE_NAMES: Record<string, string> = {
  route_to_ae: "Exceptional, routed to the AE",
  pa_meeting: "PA takes the call",
  qualify_first: "Requires discovery",
  clarify_once: "One clarification email",
};

/** On a first visit, the playbook's route cadences become sequences. */
export async function ensureSequences(repository: PaRepository) {
  const existing = await repository.listSequences();
  if (existing.length > 0) return existing;
  const params = cadenceParams(await activeRelease(repository));
  const at = now().toISOString();
  const base = {
    description: "",
    createdBy: "system:seed",
    updatedBy: "system:seed",
    archived: false,
    version: 1,
    createdAt: at,
    updatedAt: at,
  };
  for (const route of ["route_to_ae", "pa_meeting", "qualify_first"]) {
    const cadence = cadenceFor(params, route);
    if (!cadence) continue;
    await repository.insertSequence({
      ...base,
      id: newId(),
      name: `${ROUTE_NAMES[route]} (agent-written)`,
      kind: "dynamic",
      description:
        "The agent writes each follow-up from the lead's message and the step's purpose. You approve each one.",
      recommendedFor: [route],
      steps: cadence.steps.map((step, index) => ({
        id: `s${index + 1}`,
        day: step.day,
        thread: step.thread ?? "reply",
        cc_ae: step.cc_ae ?? cadence.cc_ae ?? true,
        purpose: step.purpose,
        subject: "",
        body: "",
      })),
    });
  }
  await repository.insertSequence({
    ...base,
    id: newId(),
    name: "Requires discovery (editable)",
    kind: "template",
    description:
      "Fixed emails you review and edit for each lead when you enroll them. Enrolling approves them; each sends on its day.",
    recommendedFor: [],
    steps: [
      {
        id: "s1",
        day: 3,
        thread: "reply",
        cc_ae: true,
        purpose: "One discovery question",
        subject: "",
        body: "Hi {{first_name}},\n\nOne question that would help me point you to the right setup: who on your team would own this day to day, and what does the current process look like?\n\nA line or two is plenty.\n\n{{owner_first_name}}",
      },
      {
        id: "s2",
        day: 7,
        thread: "reply",
        cc_ae: true,
        purpose: "Close the loop",
        subject: "",
        body: "Hi {{first_name}},\n\nI don't want to crowd your inbox. If this is still on the list for {{company}}, I'm happy to walk through it whenever it suits you. If the timing is off, no problem at all.\n\n{{owner_first_name}}",
      },
    ],
  });
  return repository.listSequences();
}

export interface PreviewStep {
  stepId: string;
  index: number;
  day: number;
  dueAt: string;
  thread: "reply" | "new";
  cc: string | null;
  purpose: string;
  /** Template: the email filled for this lead. Dynamic: null. */
  subject: string | null;
  body: string | null;
  problems: Array<{ code: string; message: string }>;
}

/** Can this person enroll this lead now; why not. */
async function enrollBlocker(
  repository: PaRepository,
  engagement: EngagementRecord,
  actor: string | null,
): Promise<string | null> {
  const owner = await leadOwnerEmail(repository, engagement);
  if (!engagement.firstTouchAt)
    return "Send the first touch first. The sequence follows it.";
  if (!owner) return "The lead has no owner yet.";
  if (actor && owner !== actor)
    return `Only ${owner}, the lead's owner, can enroll it. The emails go from their Gmail.`;
  const movedOn = await movedOnOfEngagement(repository, engagement.id);
  if (movedOn)
    return `HubSpot moved this lead on (${movedOn.reason.toLowerCase()}).`;
  const contact = await repository.getContact(engagement.contactId);
  if (contact?.optOut) return "This contact opted out of email.";
  return null;
}

async function tokenValues(
  repository: PaRepository,
  engagement: EngagementRecord,
  owner: string | null,
) {
  const contact = await repository.getContact(engagement.contactId);
  const submissions = await repository.listSubmissionsForEngagement(
    engagement.id,
  );
  const latest = submissions[submissions.length - 1];
  const first = (name: string | null | undefined) =>
    name?.trim().split(/\s+/)[0] || null;
  const people = await repository.listPeople();
  const profiles = await repository.listProfiles();
  const ownerName =
    people.find((item) => item.email.toLowerCase() === owner)?.displayName ??
    profiles.find((item) => item.email.toLowerCase() === owner)?.displayName ??
    (owner ? await gmailClient.firstName(owner).catch(() => null) : null);
  return {
    first_name: first(contact?.name ?? latest?.name),
    company: latest?.companyName ?? null,
    owner_first_name: first(ownerName),
    meeting_link: await routeLinkOf(repository, engagement.id),
  };
}

/** The sequence as it would run for this lead: days, and filled emails. */
export async function previewEnrollment(
  repository: PaRepository,
  engagement: EngagementRecord,
  sequence: SequenceRecord,
  edits: Record<string, { subject?: string; body?: string }> = {},
): Promise<{ steps: PreviewStep[]; blocker: string | null }> {
  const owner = await leadOwnerEmail(repository, engagement);
  const release = await activeRelease(repository);
  const route = await routeForEngagement(repository, release, engagement);
  const draftRoute = draftRouteOf(route);
  const { zone } = await leadZoneOf(repository, engagement.id);
  const windowStart = cadenceSettings(cadenceParams(release)).window_start;
  const start = engagement.firstTouchAt ?? now().toISOString();
  const first = await firstTouchOf(repository, engagement.id);
  const values =
    sequence.kind === "template"
      ? await tokenValues(repository, engagement, owner)
      : null;
  const earlier = [first.body ?? ""].filter(Boolean);
  const steps: PreviewStep[] = orderedSteps(sequence.steps).map(
    (step, index) => {
      const cc =
        route.route === "route_to_ae" && step.cc_ae ? draftRoute.cc : null;
      const base = {
        stepId: step.id,
        index: index + 1,
        day: step.day,
        dueAt: dueDate(start, step.day, zone, windowStart),
        thread: step.thread,
        cc,
        purpose: step.purpose,
      };
      if (!values) return { ...base, subject: null, body: null, problems: [] };
      const edit = edits[step.id] ?? {};
      const body = edit.body ?? fillTemplate(step.body, values);
      const subject =
        step.thread === "new"
          ? (edit.subject ?? fillTemplate(step.subject, values))
          : replySubject(first.subject);
      const lint = lintFollowUp({
        body,
        release,
        earlier: [...earlier],
        link: values.meeting_link,
        newThread: step.thread === "new",
        subject,
      });
      const problems = [...lint.problems];
      if (UNFILLED_TOKEN.test(body) || UNFILLED_TOKEN.test(subject))
        problems.push({
          code: "token",
          message: `${(body.match(UNFILLED_TOKEN) ?? subject.match(UNFILLED_TOKEN))?.[0]} has no value for this lead. Write it in.`,
        });
      earlier.push(body);
      return { ...base, subject, body, problems };
    },
  );
  return {
    steps,
    blocker: await enrollBlocker(repository, engagement, null),
  };
}

export class EnrollRefused extends Error {
  constructor(
    message: string,
    readonly problems: PreviewStep[] = [],
  ) {
    super(message);
    this.name = "EnrollRefused";
  }
}

/**
 * Enrolls a lead (D105). Only its owner, after the first touch. A lead in
 * another sequence moves to this one. Template emails must pass the checks;
 * enrolling approves them, and each sends on its day.
 */
export async function enrollInSequence(
  repository: PaRepository,
  input: {
    engagementId: string;
    sequenceId: string;
    actorEmail: string;
    edits?: Record<string, { subject?: string; body?: string }>;
  },
) {
  const engagement = await repository.getEngagement(input.engagementId);
  if (!engagement) throw new EnrollRefused("Lead not found");
  const sequence = await repository.getSequence(input.sequenceId);
  if (!sequence || sequence.archived)
    throw new EnrollRefused("That sequence is not available.");
  const actor = input.actorEmail.toLowerCase();
  const blocker = await enrollBlocker(repository, engagement, actor);
  if (blocker) throw new EnrollRefused(blocker);
  const preview = await previewEnrollment(
    repository,
    engagement,
    sequence,
    input.edits ?? {},
  );
  const failing = preview.steps.filter((step) => step.problems.length > 0);
  if (failing.length > 0)
    throw new EnrollRefused(
      `Fix step ${failing.map((step) => step.index).join(", ")} before enrolling.`,
      failing,
    );
  // One sequence at a time: moving ends the current one.
  await stopFollowUps(repository, engagement.id, `Moved to ${sequence.name}`, {
    kind: "moved",
  });
  const release = await activeRelease(repository);
  const route = await routeForEngagement(repository, release, engagement);
  const at = now().toISOString();
  const previous = await repository.listFollowUps(engagement.id);
  const offset = previous.reduce((max, row) => Math.max(max, row.stepIndex), 0);
  const rows: FollowUpRecord[] = preview.steps.map((step) => ({
    id: newId(),
    engagementId: engagement.id,
    route: route.route,
    stepIndex: offset + step.index,
    day: step.day,
    purpose: step.purpose,
    dueAt: step.dueAt,
    status: sequence.kind === "template" ? "approved" : "scheduled",
    subject: step.subject,
    body: step.body,
    lint:
      sequence.kind === "template"
        ? { ok: true, problems: [], source: "template" }
        : null,
    cc: step.cc,
    thread: step.thread,
    sequenceId: sequence.id,
    approvedBy: sequence.kind === "template" ? actor : null,
    stopReason: null,
    sentAt: null,
    gmailId: null,
    editedBy: null,
    version: 1,
    createdAt: at,
    updatedAt: at,
  }));
  await repository.insertFollowUps(rows);
  await repository.appendEvent({
    id: newId(),
    engagementId: engagement.id,
    correlationId: engagement.id,
    type: ENROLLED_EVENT,
    actor: `user:${actor}`,
    payload: {
      steps: rows.length,
      sequence_id: sequence.id,
      sequence: sequence.name,
      kind: sequence.kind,
    },
    receiptId: null,
    occurredAt: at,
  });
  return { enrolled: true, steps: rows.length, sequence: sequence.name };
}

/** Within the send window, on a business day, in the lead's time zone. */
function inWindow(at: Date, zone: string, start: string, end: string) {
  const local = zonedParts(at, zone);
  if (local.isoWeekday > 5) return false;
  const hm = `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`;
  return hm >= start && hm < end;
}

/** Sends a template sequence's approved emails that are due (D105). */
export async function sendApprovedFollowUps(budgetMs = 15_000, limit = 10) {
  const repository = repo();
  const started = Date.now();
  const at = now();
  const due = (await repository.listOpenFollowUps()).filter(
    (row) => row.status === "approved" && row.dueAt <= at.toISOString(),
  );
  if (due.length === 0) return { sent: 0, waiting: 0, failed: 0 };
  const release = await activeRelease(repository);
  const settings = cadenceSettings(cadenceParams(release));
  let sent = 0;
  let waiting = 0;
  let failed = 0;
  for (const row of due.slice(0, limit)) {
    if (Date.now() - started > budgetMs) break;
    if (!row.approvedBy) continue;
    const { zone } = await leadZoneOf(repository, row.engagementId);
    if (!inWindow(at, zone, settings.window_start, settings.window_end)) {
      waiting += 1;
      continue;
    }
    try {
      await sendFollowUp(
        {
          repository,
          gmail: gmailClient,
          now,
          newId,
          stopReason: (engagementId) => blockerNow(repository, engagementId),
          stop: async () => 0,
          linkFor: (engagementId) => routeLinkOf(repository, engagementId),
          caps: settings,
        },
        { followUpId: row.id, actorEmail: row.approvedBy },
      );
      sent += 1;
    } catch (error) {
      const code = error instanceof SendRefused ? error.code : "gmail";
      // Caps, order, and stops wait or are already applied; a refusal from
      // Gmail or the checks goes to the owner to fix.
      if (
        code === "not_sendable" ||
        code === "moved_on" ||
        code === "in_flight"
      ) {
        waiting += 1;
        continue;
      }
      const fresh = await repository.getFollowUp(row.id);
      if (fresh && fresh.status === "approved")
        await repository.updateFollowUp(
          fresh.id,
          {
            status: "needs_edit",
            lint: {
              ok: false,
              problems: [
                {
                  code: "send_failed",
                  message: `It did not send on its day: ${error instanceof Error ? error.message : "unknown error"}`,
                },
              ],
              source: "template",
            },
            updatedAt: now().toISOString(),
          },
          fresh.version,
        );
      failed += 1;
    }
  }
  return { sent, waiting, failed };
}

export type { SequenceInput };
