// Follow-up cadences (D101): the playbook block, the follow-up checks, the
// schedule, and sending a follow-up in the thread.
import { describe, expect, it } from "vitest";

import { lintFollowUp, overlap } from "../../server/core/drafting/follow-up.js";
import { seedRelease } from "../../server/core/playbook/release.js";
import { MemoryRepository } from "../../server/core/repo/memory.js";
import type { FollowUpRecord } from "../../server/core/repo/types.js";
import { SendRefused } from "../../server/lib/first-touch-send.js";
import type { GmailClient, OutgoingEmail } from "../../server/lib/gmail.js";
import { cadenceFor, cadenceParamsSchema } from "../../shared/cadence.js";
import { fixedClock, idFactory } from "../helpers.js";

const OWNER = "owner@example.com";
const AT = "2026-10-01T15:00:00.000Z";
const FIRST =
  "Hi Lead,\n\nThanks for reaching out about building a portal from scratch. Teams starting fresh usually pick the stack first.\n\nCould you share your role on this project?\n\nLooking forward to your response,\nOwner";

describe("the cadence block", () => {
  it("the seeded cadence validates and lists each route's steps in day order", () => {
    const entry = seedRelease.entries.find(
      (item) => item.id === "rule.follow_ups.cadence",
    );
    const params = cadenceParamsSchema.parse(entry?.params);
    expect(cadenceFor(params, "route_to_ae")?.steps.map((s) => s.day)).toEqual([
      1, 3, 6,
    ]);
    expect(cadenceFor(params, "route_to_ae")?.cc_ae).toBe(true);
    // Off, or a route without a cadence: no follow-ups.
    expect(cadenceFor(params, "clarify_once")).toBeNull();
    expect(cadenceFor(params, "agency")).toBeNull();
    expect(
      cadenceFor(
        {
          qualify_first: {
            enabled: true,
            steps: [
              { day: 7, purpose: "Close the loop" },
              { day: 3, purpose: "One question" },
            ],
          },
        },
        "qualify_first",
      )?.steps.map((s) => s.day),
    ).toEqual([3, 7]);
  });

  it("schedules in the lead's business hours, off weekends", async () => {
    const { dueDate } = await import("../../server/lib/follow-ups.js");
    // Thursday 10:00 in Chicago; day 1 is Friday at 08:00 there.
    expect(dueDate("2026-10-01T15:00:00.000Z", 1)).toBe(
      "2026-10-02T13:00:00.000Z",
    );
    // Day 2 is Saturday: moved to Monday at 08:00.
    expect(dueDate("2026-10-01T15:00:00.000Z", 2)).toBe(
      "2026-10-05T13:00:00.000Z",
    );
    // In London, at the window start set in the cadence.
    expect(
      dueDate("2026-10-01T15:00:00.000Z", 1, "Europe/London", "09:30"),
    ).toBe("2026-10-02T08:30:00.000Z");
  });
});

describe("the follow-up checks", () => {
  const lint = (body: string, link: string | null = null) =>
    lintFollowUp({ body, release: seedRelease, earlier: [FIRST], link });

  it("passes a short, new reply", () => {
    const result = lint(
      "Hi Lead,\n\nOne example: a retail team rebuilt their partner portal on Builder and shipped the first version in three weeks. Would a similar timeline work for you?\n\nBest,\n[owner first name]",
    );
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("catches repeats, empty bumps, dashes, and a link with none on file", () => {
    const codes = (body: string, link: string | null = null) =>
      lint(body, link).problems.map((item) => item.code);
    expect(
      codes(
        "Hi Lead,\n\nThanks for reaching out about building a portal from scratch. Teams starting fresh usually pick the stack first.\n\nOwner",
      ),
    ).toContain("repeats");
    expect(
      codes(
        "Hi Lead, just checking in on my last note about the portal and whether you had a moment to look at it this week.",
      ),
    ).toContain("empty_bump");
    expect(
      codes(
        "Hi Lead, one example — a retail team shipped their partner portal in three weeks with a small team. Want the details?",
      ),
    ).toContain("dash");
    expect(
      codes(
        "Hi Lead, a retail team shipped their partner portal in three weeks with a small team. Grab a time here: [meeting link]",
      ),
    ).toContain("meeting_link");
    expect(codes("Hi Lead, quick one.")).toContain("word_range");
    expect(overlap(FIRST, FIRST)).toBe(1);
  });
});

function gmail() {
  const calls: OutgoingEmail[] = [];
  const client: GmailClient = {
    async firstName() {
      return null;
    },
    async send(_owner, email) {
      calls.push(email);
      return { id: `msg-${calls.length}`, threadId: "thread-1" };
    },
    async saveDraft() {
      return { id: "d" };
    },
  };
  return { client, calls };
}

async function seeded() {
  const repository = new MemoryRepository();
  const clock = fixedClock(new Date("2026-10-02T16:00:00.000Z"));
  const newId = idFactory(clock);
  await repository.upsertProfile({
    id: "p-owner",
    userId: OWNER,
    email: OWNER,
    displayName: "Owner Person",
    slackUserId: null,
    crmOwnerId: null,
    timezone: "UTC",
    workingHours: {} as never,
    roles: ["pa"],
    inRoundRobin: false,
    isDesignPartner: false,
    isSynthetic: true,
    version: 1,
    createdAt: AT,
    updatedAt: AT,
  });
  await repository.insertContact({
    id: "c1",
    email: "lead@prospect.example",
    name: "Lead Person",
    title: null,
    accountId: null,
    crmContactRef: null,
    language: "en",
    optOut: false,
    version: 1,
    createdAt: AT,
    updatedAt: AT,
  });
  await repository.insertEngagement({
    id: "e1",
    accountId: null,
    contactId: "c1",
    motion: "contact_sale",
    state: "first_touch_sent",
    ownerUserId: "p-owner",
    ownerSource: "crm",
    routeReason: null,
    relationshipState: null,
    firstTouchDueAt: null,
    decisionDueAt: null,
    firstTouchAt: AT,
    outcome: null,
    attachedToId: null,
    playbookReleaseId: "release-1",
    mode: "live",
    reviewFlags: [],
    version: 1,
    createdAt: AT,
    updatedAt: AT,
  });
  await repository.appendEvent({
    id: "ev1",
    engagementId: "e1",
    correlationId: "e1",
    type: "first_touch.email",
    actor: `user:${OWNER}`,
    payload: {
      kind: "sent_from_pa",
      subject: "Your portal question",
      preview: FIRST,
      message_id: "<pa-first@xdr-hub.netlify.app>",
      thread_id: "thread-1",
    },
    receiptId: null,
    occurredAt: AT,
  });
  const row = (
    step: number,
    status: FollowUpRecord["status"],
  ): FollowUpRecord => ({
    id: `f${step}`,
    engagementId: "e1",
    route: "route_to_ae",
    stepIndex: step,
    day: step,
    purpose: "Share one example",
    dueAt: AT,
    status,
    subject: "Re: Your portal question",
    body: "Hi Lead,\n\nA retail team shipped their partner portal in three weeks. Want to see how? Grab a time here: [meeting link]\n\nBest,\n[owner first name]",
    lint: null,
    cc: "ae@example.com",
    stopReason: null,
    sentAt: null,
    gmailId: null,
    editedBy: null,
    version: 1,
    createdAt: AT,
    updatedAt: AT,
  });
  await repository.insertFollowUps([row(1, "drafted"), row(2, "drafted")]);
  return { repository, clock, newId };
}

async function send(
  base: Awaited<ReturnType<typeof seeded>>,
  client: GmailClient,
  followUpId: string,
  opts: {
    actor?: string;
    reason?: string | null;
    caps?: { daily_cap: number; company_daily_cap: number };
  } = {},
) {
  const { sendFollowUp } = await import("../../server/lib/follow-up-send.js");
  const { stopFollowUps } = await import("../../server/lib/follow-ups.js");
  return sendFollowUp(
    {
      repository: base.repository,
      gmail: client,
      now: base.clock.now,
      newId: base.newId,
      stopReason: async () => opts.reason ?? null,
      stop: (engagementId, reason) =>
        stopFollowUps(base.repository, engagementId, reason),
      linkFor: async () => "https://cal.example/ae",
      caps: opts.caps,
    },
    { followUpId, actorEmail: opts.actor ?? OWNER },
  );
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SendRefused) return error.code;
    throw error;
  }
  return null;
}

describe("sending a follow-up", () => {
  it("replies in the first touch's thread, fills the link and name, and sends once", async () => {
    const base = await seeded();
    const mail = gmail();
    await send(base, mail.client, "f1");
    expect(mail.calls).toHaveLength(1);
    expect(mail.calls[0]).toMatchObject({
      to: "lead@prospect.example",
      cc: "ae@example.com",
      subject: "Re: Your portal question",
      inReplyTo: "<pa-first@xdr-hub.netlify.app>",
      threadId: "thread-1",
    });
    expect(mail.calls[0]?.body).toContain("https://cal.example/ae");
    expect(mail.calls[0]?.body).toMatch(/\nOwner$/);
    expect((await base.repository.getFollowUp("f1"))?.status).toBe("sent");
    expect(await refusal(send(base, mail.client, "f1"))).toBe("already_sent");
    expect(mail.calls).toHaveLength(1);
  });

  it("keeps the order, and only the owner sends", async () => {
    const base = await seeded();
    const mail = gmail();
    expect(await refusal(send(base, mail.client, "f2"))).toBe("not_sendable");
    expect(
      await refusal(
        send(base, mail.client, "f1", { actor: "else@example.com" }),
      ),
    ).toBe("not_owner");
    expect(mail.calls).toHaveLength(0);
  });

  it("stops everything and sends nothing when the lead just replied", async () => {
    const base = await seeded();
    const mail = gmail();
    expect(
      await refusal(send(base, mail.client, "f1", { reason: "They replied" })),
    ).toBe("moved_on");
    expect(mail.calls).toHaveLength(0);
    const rows = await base.repository.listFollowUps("e1");
    expect(rows.map((row) => row.status)).toEqual(["stopped", "stopped"]);
    expect(rows[0]?.stopReason).toBe("They replied");
  });
});

describe("caps and reply labels (D103)", () => {
  it("stops a rep at the daily cap, and holds a second email to one company", async () => {
    const base = await seeded();
    const mail = gmail();
    const caps = { daily_cap: 1, company_daily_cap: 5 };
    await send(base, mail.client, "f1", { caps });
    expect(await refusal(send(base, mail.client, "f2", { caps }))).toBe(
      "not_sendable",
    );
    expect(mail.calls).toHaveLength(1);

    const company = await seeded();
    const engagement = (await company.repository.getEngagement("e1"))!;
    await company.repository.updateEngagement(
      "e1",
      { accountId: "acc1" },
      engagement.version,
    );
    await company.repository.insertEngagement({
      ...engagement,
      id: "e2",
      contactId: "c2",
      accountId: "acc1",
      version: 1,
    });
    await company.repository.insertOutboxIfAbsent({
      id: "o2",
      kind: "gmail_send",
      idempotencyKey: "follow_up:other",
      engagementId: "e2",
      payload: { by: "someone@example.com" },
      status: "sent",
      attempts: 1,
      nextAttemptAt: null,
      providerRef: "m",
      lastError: null,
      version: 1,
      createdAt: "2026-10-02T12:00:00.000Z",
      updatedAt: "2026-10-02T12:00:00.000Z",
    });
    expect(
      await refusal(
        send(company, mail.client, "f1", {
          caps: { daily_cap: 40, company_daily_cap: 1 },
        }),
      ),
    ).toBe("not_sendable");
  });

  it("a reply relabeled as out of office puts the follow-ups back after the return date", async () => {
    const { labelReply, stopFollowUps } =
      await import("../../server/lib/follow-ups.js");
    const base = await seeded();
    await stopFollowUps(base.repository, "e1", "They replied", {
      kind: "reply",
      email_id: "r1",
    });
    const result = await labelReply(base.repository, {
      engagementId: "e1",
      emailId: "r1",
      label: "out_of_office",
      summary: "Auto-reply",
      returnDate: "2099-01-10",
      actor: "agent:reply-label",
    });
    expect(result.resumed).toBe(2);
    const rows = await base.repository.listFollowUps("e1");
    expect(rows.map((row) => row.status)).toEqual(["drafted", "drafted"]);
    expect(rows[0]?.dueAt >= "2099-01-10").toBe(true);

    await labelReply(base.repository, {
      engagementId: "e1",
      emailId: "r2",
      label: "unsubscribe",
      summary: null,
      returnDate: null,
      actor: "agent:reply-label",
    });
    expect((await base.repository.getContact("c1"))?.optOut).toBe(true);
  });
});

describe("per-step settings (D104)", () => {
  it("a new-email step sends its own subject, outside the thread", async () => {
    const base = await seeded();
    const row = (await base.repository.getFollowUp("f1"))!;
    await base.repository.updateFollowUp(
      "f1",
      { thread: "new", subject: "A portal example for your team" },
      row.version,
    );
    const mail = gmail();
    await send(base, mail.client, "f1");
    expect(mail.calls[0]?.subject).toBe("A portal example for your team");
    expect(mail.calls[0]?.inReplyTo ?? null).toBeNull();
    expect(mail.calls[0]?.threadId ?? null).toBeNull();
  });

  it("checks a new email's subject", () => {
    const body =
      "Hi Lead,\n\nOne example: a retail team rebuilt their partner portal on Builder and shipped the first version in three weeks. Would a similar timeline work for you?\n\nBest,\n[owner first name]";
    const codes = (subject: string | null) =>
      lintFollowUp({
        body,
        release: seedRelease,
        earlier: [FIRST],
        link: null,
        newThread: true,
        subject,
      }).problems.map((item) => item.code);
    expect(codes(null)).toContain("subject");
    expect(codes("Re: your portal")).toContain("subject");
    expect(codes("A portal example for your team")).toEqual([]);
  });
});

describe("follow-ups read like an email (D106)", () => {
  it("needs a greeting line, a blank line, and a sign-off with the name", () => {
    const codes = (body: string) =>
      lintFollowUp({
        body,
        release: seedRelease,
        earlier: [FIRST],
        link: null,
      }).problems.map((item) => item.code);
    // The draft Fred saw: no greeting line, no sign-off.
    expect(
      codes(
        "Jake, since privacy mode is the only blocker you named, we can switch it on for your account ahead of time so your team tests directly against your repo from day one. Worth 15 minutes with Dakota to confirm the setup?\n\nJavier",
      ),
    ).toEqual(expect.arrayContaining(["greeting", "signoff"]));
    expect(
      codes(
        "Hi Jake,\nSince privacy mode is the only blocker you named, we can switch it on for your account ahead of time. Worth 15 minutes with Dakota to confirm the setup?\n\nBest,\n[owner first name]",
      ),
    ).toContain("greeting");
    expect(
      codes(
        "Hi Jake,\n\nSince privacy mode is the only blocker you named, we can switch it on for your account ahead of time. Worth 15 minutes with Dakota to confirm the setup?\n\nBest,\n[owner first name]",
      ),
    ).toEqual([]);
  });
});
