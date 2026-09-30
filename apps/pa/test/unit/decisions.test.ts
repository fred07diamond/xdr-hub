// The rep decision loop (D59) and the minute poll's signature (D58).
import { describe, expect, it } from "vitest";

import {
  decide,
  markMissedDeadlines,
  recommend,
  type DecisionInputs,
} from "../../server/core/decisions/index.js";
import { seedRelease } from "../../server/core/playbook/release.js";
import { replaySyntheticCases } from "../../server/core/replay/index.js";
import { MemoryRepository } from "../../server/core/repo/memory.js";
import { signPoll, verifyPoll } from "../../server/lib/poll-signature.js";
import { fixedClock, idFactory } from "../helpers.js";

async function replayed() {
  const repo = new MemoryRepository();
  const clock = fixedClock();
  const newId = idFactory(clock);
  const results = await replaySyntheticCases({
    repo,
    release: seedRelease,
    now: clock.now,
    newId,
    linkUserId: "dev@local.test",
  });
  const byCase = new Map(results.map((item) => [item.caseId, item]));
  return {
    repo,
    clock,
    deps: { repo, release: seedRelease, now: clock.now, newId },
    id: (caseId: string) => byCase.get(caseId)!.engagementId as string,
  };
}

describe("which leads get a decision", () => {
  it("gives new and owned leads a decision, and settled leads none", async () => {
    const { repo, id } = await replayed();
    expect(
      (await repo.getDecision(id("direct-new-unowned")))?.recommendation,
    ).toBe("accept");
    expect(
      (await repo.getDecision(id("agency-already-sal")))?.recommendation,
    ).toBe("accept");
    expect(
      (await repo.getDecision(id("injection-attempt")))?.recommendation,
    ).toBe("research");
    for (const settled of [
      "support-request",
      "student",
      "vendor-pitch",
      "open-deal-with-ae",
    ])
      expect(await repo.getDecision(id(settled)), settled).toBeNull();
  });

  it("recommends by the meeting when one is booked after the form", () => {
    const base = {
      engagement: { reviewFlags: [] },
      submittedAt: "2026-09-30T16:00:00.000Z",
      precheckOutcome: "continue",
      signal: null,
      verdict: "ql",
      flagged: false,
      ownerEmail: null,
    } as unknown as DecisionInputs;
    const booked = recommend({
      ...base,
      snapshot: {
        contact: { meetingBookedAt: "2026-09-30T16:05:00.000Z" },
        openDeals: [],
      },
    } as unknown as DecisionInputs);
    expect(booked.kind).toBe("meeting_booked");
    expect(booked.recommendation).toBe("take_meeting");
    const customer = recommend({
      ...base,
      precheckOutcome: "attach_to_owner",
      signal: "existing_deal_or_customer",
      snapshot: { contact: null, openDeals: [] },
    } as unknown as DecisionInputs);
    expect(customer.options).toContain("customer_redirect");
    expect(customer.question).toMatch(/team already using Builder/);
  });
});

describe("deciding", () => {
  it("accept moves the lead to SAL in PA; research keeps it open", async () => {
    const { repo, deps, id } = await replayed();
    const lead = id("direct-new-unowned");
    await decide(deps, {
      engagementId: lead,
      choice: "research",
      note: "Check the SSO ask",
      actor: "user:pa@example.com",
    });
    expect((await repo.getDecision(lead))?.status).toBe("open");
    const done = await decide(deps, {
      engagementId: lead,
      choice: "accept",
      note: null,
      actor: "user:pa@example.com",
    });
    expect(done).toMatchObject({ status: "decided", choice: "accept" });
    expect((await repo.getEngagement(lead))?.state).toBe("sal");
    await expect(
      decide(deps, {
        engagementId: lead,
        choice: "decline",
        note: null,
        actor: "user:pa@example.com",
      }),
    ).rejects.toThrow(/Already decided/);
  });

  it("refuses a choice that is not offered", async () => {
    const { deps, id } = await replayed();
    await expect(
      decide(deps, {
        engagementId: id("direct-new-unowned"),
        choice: "take_meeting",
        note: null,
        actor: "user:pa@example.com",
      }),
    ).rejects.toThrow(/not an option/);
  });

  it("records a missed deadline once, and changes nothing else", async () => {
    const { repo, deps, clock, id } = await replayed();
    clock.advance(25 * 60 * 60_000);
    const missed = await markMissedDeadlines(deps);
    expect(missed.length).toBeGreaterThan(0);
    expect(await markMissedDeadlines(deps)).toEqual([]);
    const lead = id("direct-new-unowned");
    expect((await repo.getDecision(lead))?.status).toBe("open");
    expect((await repo.getEngagement(lead))?.state).toBe(
      "awaiting_first_touch",
    );
  });
});

describe("the minute poll signature", () => {
  it("accepts a fresh signature and refuses a stale or forged one", () => {
    const now = Date.parse("2026-09-30T20:00:00.000Z");
    const timestamp = String(now);
    const signature = signPoll("secret", timestamp);
    expect(verifyPoll({ secret: "secret", timestamp, signature, now })).toBe(
      true,
    );
    expect(
      verifyPoll({
        secret: "secret",
        timestamp,
        signature: "x".repeat(64),
        now,
      }),
    ).toBe(false);
    expect(
      verifyPoll({
        secret: "secret",
        timestamp,
        signature,
        now: now + 10 * 60_000,
      }),
    ).toBe(false);
    expect(verifyPoll({ secret: undefined, timestamp, signature, now })).toBe(
      false,
    );
  });
});
