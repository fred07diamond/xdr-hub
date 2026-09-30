import { beforeEach, describe, expect, it } from "vitest";

import { seedRelease } from "../../server/core/playbook/release.js";
import { replaySyntheticCases } from "../../server/core/replay/index.js";
import { MemoryRepository } from "../../server/core/repo/memory.js";
import { fixedClock, idFactory } from "../helpers.js";

const EXPECTED: Record<
  string,
  {
    precheck: string;
    route: string;
    verdict: string;
    state: string;
    flagged: boolean;
  }
> = {
  "agency-already-sal": {
    precheck: "attach_to_owner",
    route: "existing_active_owner",
    verdict: "attach_existing",
    state: "attached",
    flagged: false,
  },
  "direct-new-unowned": {
    precheck: "continue",
    route: "round_robin",
    verdict: "ql",
    state: "awaiting_first_touch",
    flagged: false,
  },
  "support-request": {
    precheck: "route_to_support",
    route: "support",
    verdict: "route_elsewhere",
    state: "closed",
    flagged: false,
  },
  student: {
    precheck: "self_serve_thank_you",
    route: "none",
    verdict: "disqualify",
    state: "disqualified",
    flagged: false,
  },
  "vendor-pitch": {
    precheck: "ignore_logged",
    route: "none",
    verdict: "disqualify",
    state: "disqualified",
    flagged: false,
  },
  "open-deal-with-ae": {
    precheck: "attach_to_owner",
    route: "deal_or_customer_owner",
    verdict: "attach_existing",
    state: "attached",
    flagged: false,
  },
  "injection-attempt": {
    precheck: "continue",
    route: "round_robin",
    verdict: "recycle",
    state: "awaiting_first_touch",
    flagged: true,
  },
};

describe("synthetic replay through the pipeline", () => {
  let repo: MemoryRepository;
  let clock: ReturnType<typeof fixedClock>;

  beforeEach(() => {
    repo = new MemoryRepository();
    clock = fixedClock();
  });

  async function replay() {
    return replaySyntheticCases({
      repo,
      release: seedRelease,
      now: clock.now,
      newId: idFactory(clock),
      linkUserId: "dev@local.test",
    });
  }

  it("produces the expected pre-check, route, verdict, and state for all seven cases", async () => {
    const results = await replay();
    expect(results).toHaveLength(7);
    for (const result of results) {
      const expected = EXPECTED[result.caseId];
      expect(result.pipeline, result.caseId).toBe("done");
      expect(result.actual, result.caseId).toEqual({
        precheck: expected.precheck,
        route: expected.route,
        verdict: expected.verdict,
        state: expected.state,
      });
      expect(result.flaggedForReview, result.caseId).toBe(expected.flagged);
      expect(result.matches, result.caseId).toEqual({
        precheck: true,
        route: true,
        verdict: true,
      });
    }
  });

  it("is idempotent: replaying again creates no duplicate rows", async () => {
    const first = await replay();
    const countsAfterFirst = repo.counts();
    const second = await replay();
    expect(repo.counts()).toEqual(countsAfterFirst);
    expect(second.map((item) => item.engagementId)).toEqual(
      first.map((item) => item.engagementId),
    );
  });

  it("drafts new leads and owned accounts, lints every draft, and never notifies", async () => {
    const results = await replay();
    const drafted: string[] = [];
    for (const result of results) {
      const events = await repo.listEvents(result.engagementId as string);
      const skipped = events.filter((event) => event.type === "step.skipped");
      expect(skipped.map((event) => event.payload.step)).toEqual(["notify"]);
      const drafts = await repo.listDrafts(result.engagementId as string);
      if (drafts.length > 0) {
        drafted.push(result.caseId);
        expect(drafts).toHaveLength(1);
        expect(drafts[0].status).toBe("proposed");
        expect(drafts[0].lint?.ok).toBe(true);
        expect(drafts[0].source).toBe("recorded_fixture");
        // Signed with the routed owner's first name, never the placeholder.
        expect(drafts[0].body).not.toContain("{owner_first_name}");
      }
    }
    // The owned agency lead is drafted for its owner (D59); the open deal is not.
    expect(drafted.sort()).toEqual([
      "agency-already-sal",
      "direct-new-unowned",
      "injection-attempt",
    ]);
  });

  it("writes a receipt for every deterministic step, pinned to the release", async () => {
    const results = await replay();
    for (const result of results) {
      const receipts = await repo.listReceipts(result.engagementId as string);
      expect(receipts.map((receipt) => receipt.kind)).toEqual([
        "normalize",
        "crm_snapshot",
        "assess_message",
        "precheck",
        "route",
        "score",
        "draft",
      ]);
      for (const receipt of receipts) {
        expect(receipt.playbookReleaseId).toBe(seedRelease.id);
      }
      const decisionReceipts = receipts.filter((receipt) =>
        ["precheck", "route", "score"].includes(receipt.kind),
      );
      for (const receipt of decisionReceipts) {
        expect(receipt.entryVersions.length).toBeGreaterThan(0);
      }
    }
  });

  it("attaches the already-SAL agency lead to its owner with a clock and no decision clock", async () => {
    const results = await replay();
    const agency = results.find((item) => item.caseId === "agency-already-sal");
    const engagement = await repo.getEngagement(agency?.engagementId as string);
    const owner = await repo.getProfile(engagement?.ownerUserId as string);
    expect(owner?.email).toBe("pa.one@builder.io");
    expect(engagement?.routeReason).toBe(
      "Already SAL, routed to its current owner",
    );
    expect(engagement?.firstTouchDueAt).toBe("2026-09-29T17:30:00.000Z");
    expect(engagement?.decisionDueAt).toBeNull();
  });

  it("gives settled outcomes no clock and no owner", async () => {
    const results = await replay();
    for (const caseId of ["support-request", "student", "vendor-pitch"]) {
      const result = results.find((item) => item.caseId === caseId);
      const engagement = await repo.getEngagement(
        result?.engagementId as string,
      );
      expect(engagement?.ownerUserId, caseId).toBeNull();
      expect(engagement?.firstTouchDueAt, caseId).toBeNull();
      expect(engagement?.decisionDueAt, caseId).toBeNull();
    }
  });

  it("round-robins the two unowned leads across the synthetic pool", async () => {
    const results = await replay();
    const owners = await Promise.all(
      ["direct-new-unowned", "injection-attempt"].map(async (caseId) => {
        const result = results.find((item) => item.caseId === caseId);
        const engagement = await repo.getEngagement(
          result?.engagementId as string,
        );
        return (await repo.getProfile(engagement?.ownerUserId as string))
          ?.displayName;
      }),
    );
    expect(owners).toEqual(["PA One", "PA Two"]);
  });

  it("links the local dev user to the synthetic PA profile", async () => {
    await replay();
    const profile = await repo.getProfileByUserId("dev@local.test");
    expect(profile?.displayName).toBe("PA One");
  });

  it("keeps injected text as data: no extra contacts, recipients, or links", async () => {
    const results = await replay();
    const injection = results.find(
      (item) => item.caseId === "injection-attempt",
    );
    const submissions = await repo.listSubmissionsForEngagement(
      injection?.engagementId as string,
    );
    expect(submissions).toHaveLength(1);
    expect(submissions[0].flags.map((flag) => flag.pattern)).toEqual(
      expect.arrayContaining([
        "ignore_instructions",
        "record_directive",
        "contact_redirect",
        "embedded_email",
      ]),
    );
    expect(await repo.getContactByEmail("boss@unknown.example.com")).toBeNull();
  });
});
