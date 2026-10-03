// Named sequences (D105): preview for a lead, enroll (owner only, after the
// first touch), and template emails approved at enrollment.
import { describe, expect, it } from "vitest";

import { MemoryRepository } from "../../server/core/repo/memory.js";
import type { SequenceRecord } from "../../server/core/repo/types.js";
import { fillTemplate, sequenceInputSchema } from "../../shared/sequences.js";

const OWNER = "owner@example.com";
const AT = "2026-10-01T15:00:00.000Z";

async function seeded(firstTouch: string | null = AT) {
  const repository = new MemoryRepository();
  await repository.upsertProfile({
    id: "p-owner",
    userId: OWNER,
    email: OWNER,
    displayName: "Olivia Owner",
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
    name: "Lena Lead",
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
    state: firstTouch ? "first_touch_sent" : "awaiting_first_touch",
    ownerUserId: "p-owner",
    ownerSource: "crm",
    routeReason: null,
    relationshipState: null,
    firstTouchDueAt: null,
    decisionDueAt: null,
    firstTouchAt: firstTouch,
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
      preview: "Hi Lena, thanks for reaching out about the portal.",
    },
    receiptId: null,
    occurredAt: AT,
  });
  return repository;
}

function sequence(
  kind: "dynamic" | "template",
  body = "Hi {{first_name}},\n\nOne question that would help me point you to the right setup: who on your team owns this day to day, and what does the process look like now?\n\n{{owner_first_name}}",
): SequenceRecord {
  return {
    id: `seq-${kind}`,
    name: kind === "dynamic" ? "Agent-written" : "Editable",
    kind,
    description: "",
    recommendedFor: [],
    steps: [
      {
        id: "s1",
        day: 2,
        thread: "reply",
        cc_ae: true,
        purpose: "One discovery question",
        subject: "",
        body: kind === "template" ? body : "",
      },
    ],
    createdBy: OWNER,
    updatedBy: OWNER,
    archived: false,
    version: 1,
    createdAt: AT,
    updatedAt: AT,
  };
}

describe("sequences (D105)", () => {
  it("validates a sequence by kind", () => {
    const base = { name: "Test", recommendedFor: [], description: "" };
    expect(
      sequenceInputSchema.safeParse({
        ...base,
        kind: "dynamic",
        steps: [{ id: "a", day: 2, purpose: "" }],
      }).success,
    ).toBe(false);
    expect(
      sequenceInputSchema.safeParse({
        ...base,
        kind: "template",
        steps: [
          {
            id: "a",
            day: 2,
            thread: "new",
            body: "Hi {{first_name}}, a note.",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      fillTemplate("Hi {{first_name}} at {{company}}", { first_name: "Lena" }),
    ).toBe("Hi Lena at {{company}}");
  });

  it("previews an editable sequence filled for the lead, and enrolling approves it", async () => {
    const { previewEnrollment, enrollInSequence } =
      await import("../../server/lib/sequences.js");
    const repository = await seeded();
    await repository.insertSequence(sequence("template"));
    const engagement = (await repository.getEngagement("e1"))!;
    const preview = await previewEnrollment(
      repository,
      engagement,
      (await repository.getSequence("seq-template"))!,
    );
    expect(preview.steps[0]?.body).toContain("Hi Lena,");
    expect(preview.steps[0]?.body).toMatch(/\nOlivia$/);
    expect(preview.steps[0]?.subject).toBe("Re: Your portal question");
    expect(preview.steps[0]?.problems).toEqual([]);

    await enrollInSequence(repository, {
      engagementId: "e1",
      sequenceId: "seq-template",
      actorEmail: OWNER,
      edits: {
        s1: {
          body: `${preview.steps[0]?.body}`.replace(
            "One question",
            "A quick question",
          ),
        },
      },
    });
    const rows = await repository.listFollowUps("e1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "approved",
      approvedBy: OWNER,
      sequenceId: "seq-template",
    });
    expect(rows[0]?.body).toContain("A quick question");
  });

  it("enrolls an agent-written sequence as scheduled, and moves a lead between sequences", async () => {
    const { enrollInSequence } = await import("../../server/lib/sequences.js");
    const repository = await seeded();
    await repository.insertSequence(sequence("template"));
    await repository.insertSequence(sequence("dynamic"));
    await enrollInSequence(repository, {
      engagementId: "e1",
      sequenceId: "seq-template",
      actorEmail: OWNER,
    });
    await enrollInSequence(repository, {
      engagementId: "e1",
      sequenceId: "seq-dynamic",
      actorEmail: OWNER,
    });
    const rows = await repository.listFollowUps("e1");
    expect(rows.map((row) => row.status)).toEqual(["stopped", "scheduled"]);
    expect(rows[0]?.stopReason).toBe("Moved to Agent-written");
  });

  it("refuses non-owners, leads with no first touch, and blanks left in an email", async () => {
    const { enrollInSequence } = await import("../../server/lib/sequences.js");
    const refusal = (promise: Promise<unknown>) =>
      promise.then(
        () => null,
        (error: Error) => error.message,
      );
    const repository = await seeded();
    await repository.insertSequence(sequence("dynamic"));
    expect(
      await refusal(
        enrollInSequence(repository, {
          engagementId: "e1",
          sequenceId: "seq-dynamic",
          actorEmail: "else@example.com",
        }),
      ),
    ).toMatch(/Only owner@example.com/);

    const early = await seeded(null);
    await early.insertSequence(sequence("dynamic"));
    expect(
      await refusal(
        enrollInSequence(early, {
          engagementId: "e1",
          sequenceId: "seq-dynamic",
          actorEmail: OWNER,
        }),
      ),
    ).toMatch(/first touch/);

    const blank = await seeded();
    await blank.insertSequence(
      sequence(
        "template",
        "Hi {{first_name}},\n\nSaw that {{company}} is looking at this; one question about your setup would help me a lot here.\n\n{{owner_first_name}}",
      ),
    );
    expect(
      await refusal(
        enrollInSequence(blank, {
          engagementId: "e1",
          sequenceId: "seq-template",
          actorEmail: OWNER,
        }),
      ),
    ).toMatch(/Fix step 1/);
  });
});
