// Approve and send from the owner's Gmail (D96): who may send, what blocks
// a send, and that a lead can never be sent twice.
import { describe, expect, it } from "vitest";

import { deliveryOf } from "../../server/core/outreach/delivery.js";
import { MemoryRepository } from "../../server/core/repo/memory.js";
import {
  approveFirstTouch,
  SendRefused,
  type SendDeps,
} from "../../server/lib/first-touch-send.js";
import {
  buildRawEmail,
  GmailError,
  type GmailClient,
  type OutgoingEmail,
} from "../../server/lib/gmail.js";
import { fixedClock, idFactory } from "../helpers.js";

const OWNER = "owner@example.com";
const AT = "2026-10-02T15:00:00.000Z";

function fakeGmail(behavior: (call: number) => void = () => {}) {
  const calls: Array<{ kind: string; owner: string; email: OutgoingEmail }> =
    [];
  const client: GmailClient = {
    async send(owner, email) {
      calls.push({ kind: "send", owner, email });
      behavior(calls.length);
      return { id: `msg-${calls.length}` };
    },
    async saveDraft(owner, email) {
      calls.push({ kind: "draft", owner, email });
      behavior(calls.length);
      return { id: `draft-${calls.length}` };
    },
  };
  return { client, calls };
}

async function seeded(
  draft: { status?: string; body?: string; lintOk?: boolean } = {},
) {
  const repository = new MemoryRepository();
  const clock = fixedClock();
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
    state: "awaiting_first_touch",
    ownerUserId: "p-owner",
    ownerSource: "crm",
    routeReason: null,
    relationshipState: null,
    firstTouchDueAt: null,
    decisionDueAt: null,
    firstTouchAt: null,
    outcome: null,
    attachedToId: null,
    playbookReleaseId: "release-1",
    mode: "live",
    reviewFlags: [],
    version: 1,
    createdAt: AT,
    updatedAt: AT,
  });
  await repository.insertDraft({
    id: "d1",
    engagementId: "e1",
    submissionId: null,
    subject: "Your Builder question",
    body:
      draft.body ??
      "Hi Lead,\n\nThanks for reaching out about Builder.\n\nLooking forward to your response,\nOwner",
    cta: "reply",
    language: "en",
    status: draft.status ?? "proposed",
    usedEntryIds: [],
    lint: {
      ok: draft.lintOk ?? true,
      problems: [],
      route: { cc: "ae@example.com" },
    },
    source: "agent",
    receiptId: null,
    version: 1,
    createdAt: AT,
    updatedAt: AT,
  });
  return { repository, clock, newId };
}

function depsOf(
  base: Awaited<ReturnType<typeof seeded>>,
  gmail: GmailClient,
): SendDeps {
  return {
    repository: base.repository,
    gmail,
    now: base.clock.now,
    newId: base.newId,
  };
}

const input = (mode: "send" | "gmail_draft", actorEmail = OWNER) => ({
  engagementId: "e1",
  draftId: "d1",
  actorEmail,
  mode,
});

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SendRefused) return error.code;
    throw error;
  }
  return null;
}

describe("approve and send (D96)", () => {
  it("sends from the owner's Gmail once, with the AE on cc, and marks the lead contacted", async () => {
    const base = await seeded();
    const gmail = fakeGmail();
    const result = await approveFirstTouch(
      depsOf(base, gmail.client),
      input("send", "Owner@Example.com"),
    );
    expect(result.sent).toBe(true);
    expect(gmail.calls).toHaveLength(1);
    expect(gmail.calls[0]).toMatchObject({
      kind: "send",
      owner: OWNER,
      email: {
        from: OWNER,
        to: "lead@prospect.example",
        cc: "ae@example.com",
        subject: "Your Builder question",
      },
    });
    const engagement = await base.repository.getEngagement("e1");
    expect(engagement?.firstTouchAt).toBeTruthy();
    expect(engagement?.state).toBe("first_touch_sent");
    const events = await base.repository.listEvents("e1");
    expect(
      events.some(
        (item) =>
          item.type === "first_touch.email" &&
          item.payload.kind === "sent_from_pa",
      ),
    ).toBe(true);
    expect(deliveryOf(await base.repository.listOutbox("e1"))?.kind).toBe(
      "sent",
    );
    // A second click never reaches Gmail.
    expect(
      await refusal(
        approveFirstTouch(depsOf(base, gmail.client), input("send")),
      ),
    ).toBe("already_sent");
    expect(gmail.calls).toHaveLength(1);
  });

  it("refuses anyone but the lead's owner", async () => {
    const base = await seeded();
    const gmail = fakeGmail();
    expect(
      await refusal(
        approveFirstTouch(
          depsOf(base, gmail.client),
          input("send", "someone@example.com"),
        ),
      ),
    ).toBe("not_owner");
    expect(gmail.calls).toHaveLength(0);
  });

  it("refuses a draft that breaks a rule, has a placeholder, or was replaced", async () => {
    const gmail = fakeGmail();
    const failing = await seeded({ status: "needs_edit", lintOk: false });
    expect(
      await refusal(
        approveFirstTouch(depsOf(failing, gmail.client), input("send")),
      ),
    ).toBe("draft_problems");
    const placeholder = await seeded({
      body: "Hi Lead,\n\nPick a time here: [calendar link]\n\nLooking forward to your response,\nOwner",
    });
    expect(
      await refusal(
        approveFirstTouch(depsOf(placeholder, gmail.client), input("send")),
      ),
    ).toBe("placeholder");
    const stale = await seeded();
    expect(
      await refusal(
        approveFirstTouch(depsOf(stale, gmail.client), {
          ...input("send"),
          draftId: "older",
        }),
      ),
    ).toBe("stale_draft");
    expect(gmail.calls).toHaveLength(0);
  });

  it("Approve saves to Gmail Drafts once and leaves the lead to do", async () => {
    const base = await seeded();
    const gmail = fakeGmail();
    const result = await approveFirstTouch(
      depsOf(base, gmail.client),
      input("gmail_draft"),
    );
    expect(result.sent).toBe(false);
    expect(gmail.calls[0]?.kind).toBe("draft");
    expect((await base.repository.getEngagement("e1"))?.firstTouchAt).toBe(
      null,
    );
    expect(deliveryOf(await base.repository.listOutbox("e1"))).toMatchObject({
      kind: "gmail_draft",
      draftId: "d1",
      by: OWNER,
    });
    expect(
      await refusal(
        approveFirstTouch(depsOf(base, gmail.client), input("gmail_draft")),
      ),
    ).toBe("already_sent");
  });

  it("retries after Gmail refuses, but never after an unknown outcome", async () => {
    const refused = await seeded();
    let fail = true;
    const flaky = fakeGmail(() => {
      if (fail) throw new GmailError("Gmail refused: quota", "gmail_refused");
    });
    expect(
      await refusal(
        approveFirstTouch(depsOf(refused, flaky.client), input("send")),
      ),
    ).toBe("gmail");
    expect(deliveryOf(await refused.repository.listOutbox("e1"))?.kind).toBe(
      "failed",
    );
    fail = false;
    const retried = await approveFirstTouch(
      depsOf(refused, flaky.client),
      input("send"),
    );
    expect(retried.sent).toBe(true);

    const unknown = await seeded();
    const timeout = fakeGmail(() => {
      throw new Error("The operation timed out");
    });
    expect(
      await refusal(
        approveFirstTouch(depsOf(unknown, timeout.client), input("send")),
      ),
    ).toBe("gmail");
    expect(
      await refusal(
        approveFirstTouch(depsOf(unknown, timeout.client), input("send")),
      ),
    ).toBe("in_flight");
    expect(timeout.calls).toHaveLength(1);
  });
});

describe("the raw Gmail message", () => {
  it("keeps headers on one line and encodes a non-ASCII subject", () => {
    const raw = buildRawEmail({
      from: OWNER,
      to: "lead@prospect.example\r\nBcc: spy@example.com",
      cc: null,
      subject: "Café question",
      body: "Hi,\nThanks.",
    });
    const text = Buffer.from(raw, "base64url").toString("utf8");
    expect(text).not.toMatch(/^Bcc:/m);
    expect(text).toContain("To: lead@prospect.example Bcc: spy@example.com");
    expect(text).toContain("Subject: =?UTF-8?B?");
    expect(text).not.toMatch(/^Cc:/m);
    const body = text.split("\r\n\r\n")[1] ?? "";
    expect(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString()).toBe(
      "Hi,\r\nThanks.",
    );
  });
});

describe("send a test to me (D97)", () => {
  it("sends only to the person clicking, even on a lead they do not own, and changes nothing", async () => {
    const { sendTestToSelf } =
      await import("../../server/lib/first-touch-send.js");
    const base = await seeded({ status: "needs_edit", lintOk: false });
    const gmail = fakeGmail();
    const result = await sendTestToSelf(depsOf(base, gmail.client), {
      engagementId: "e1",
      draftId: "d1",
      actorEmail: "Someone@Example.com",
    });
    expect(result.sentTo).toBe("someone@example.com");
    expect(gmail.calls).toHaveLength(1);
    expect(gmail.calls[0]?.email).toMatchObject({
      from: "someone@example.com",
      to: "someone@example.com",
      cc: null,
      subject: "[Test] Your Builder question",
    });
    expect(gmail.calls[0]?.email.body).toContain(
      "The real email goes to lead@prospect.example, cc ae@example.com",
    );
    const engagement = await base.repository.getEngagement("e1");
    expect(engagement?.firstTouchAt).toBe(null);
    expect(engagement?.state).toBe("awaiting_first_touch");
    expect(await base.repository.listOutbox("e1")).toHaveLength(0);
  });
});
