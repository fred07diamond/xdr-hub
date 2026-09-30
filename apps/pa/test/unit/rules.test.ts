import { describe, expect, it } from "vitest";

import type { AssessmentInput } from "../../server/core/assessment/index.js";
import type { CrmSnapshot } from "../../server/core/crm/port.js";
import { resolveIdentity } from "../../server/core/identity/index.js";
import {
  assertTransition,
  canTransition,
  InvalidTransitionError,
} from "../../server/core/objects/index.js";
import { seedRelease } from "../../server/core/playbook/release.js";
import {
  checkOwnership,
  runPrecheck,
} from "../../server/core/precheck/index.js";
import {
  pickRoundRobin,
  relationshipStateFor,
  routeEngagement,
  type RoutingProfile,
} from "../../server/core/routing/index.js";
import { scoreEngagement } from "../../server/core/scorecard/index.js";
import { releaseWith, TUESDAY_MORNING_PT } from "../helpers.js";

const now = TUESDAY_MORNING_PT;
const DAY = 24 * 60 * 60 * 1000;

function snapshot(
  overrides: {
    lifecycle?: string | null;
    owner?: string | null;
    lastActivityDays?: number | null;
    openDeals?: number;
    customer?: boolean;
  } = {},
): CrmSnapshot {
  const lifecycle =
    overrides.lifecycle === undefined ? "lead" : overrides.lifecycle;
  const owner = overrides.owner
    ? {
        ref: { system: "fixture" as const, id: `owner:${overrides.owner}` },
        email: overrides.owner,
        name: null,
      }
    : null;
  const fetchedAt = now.toISOString();
  return {
    source: "fixture",
    fetchedAt,
    contact: {
      ref: { system: "fixture", id: "contact:test" },
      email: "lead@acme.example.com",
      name: "Lead",
      lifecycle: lifecycle ? (lifecycle.toLowerCase() as never) : null,
      lifecycleRaw: lifecycle,
      owner,
      lastActivityAt:
        typeof overrides.lastActivityDays === "number"
          ? new Date(
              now.getTime() - overrides.lastActivityDays * DAY,
            ).toISOString()
          : null,
      isCustomer: overrides.customer ?? false,
      isChurned: false,
      productSignal: null,
      fetchedAt,
    },
    company: null,
    openDeals: Array.from({ length: overrides.openDeals ?? 0 }, (_, index) => ({
      ref: { system: "fixture" as const, id: `deal:${index}` },
      name: "Deal",
      stage: "open",
      owner,
      fetchedAt,
    })),
  };
}

function assessment(overrides: Partial<AssessmentInput> = {}): AssessmentInput {
  return {
    intent: "sales",
    agency_signal: false,
    evidence_quotes: [],
    end_client_named: false,
    product_interest: "unknown",
    language: "en",
    explicit_question: null,
    ...overrides,
  };
}

const hours = {
  timezone: "America/Los_Angeles",
  days: [1, 2, 3, 4, 5],
  start: "09:00",
  end: "17:00",
};
const profiles: RoutingProfile[] = [
  {
    id: "p1",
    email: "pa.one@builder.io",
    displayName: "PA One",
    workingHours: hours,
    inRoundRobin: true,
  },
  {
    id: "p2",
    email: "pa.two@pa-dev.example.com",
    displayName: "PA Two",
    workingHours: { ...hours, timezone: "America/New_York" },
    inRoundRobin: true,
  },
  {
    id: "rep",
    email: "partners@pa-dev.example.com",
    displayName: "Partner Rep",
    workingHours: hours,
    inRoundRobin: false,
  },
];
const pool = ["pa.one@builder.io", "pa.two@pa-dev.example.com"];

describe("state machine", () => {
  it("allows only declared transitions", () => {
    expect(canTransition("new", "prechecked")).toBe(true);
    expect(canTransition("prechecked", "attached")).toBe(true);
    expect(() => assertTransition("new", "awaiting_first_touch")).toThrow(
      InvalidTransitionError,
    );
    expect(() => assertTransition("closed", "new")).toThrow(
      InvalidTransitionError,
    );
  });
});

describe("ownership", () => {
  it("treats SAL with an owner and recent activity as owned", () => {
    expect(
      checkOwnership(
        snapshot({
          lifecycle: "SAL",
          owner: "pa.one@builder.io",
          lastActivityDays: 12,
        }),
        90,
        now,
      ).owned,
    ).toBe(true);
  });

  it("fails closed on unknown activity: owned, but provisional, with an open item (G3)", () => {
    const result = checkOwnership(
      snapshot({ lifecycle: "SAL", owner: "pa.one@builder.io" }),
      90,
      now,
    );
    expect(result.owned).toBe(true);
    expect(result.provisional).toBe(true);
    expect(result.basis).toMatch(/unknown/);
    expect(result.openItems.map((item) => item.code)).toContain(
      "sal_activity_unknown",
    );
  });

  it("reopens a stale SAL deliberately", () => {
    const result = checkOwnership(
      snapshot({
        lifecycle: "SAL",
        owner: "pa.one@builder.io",
        lastActivityDays: 120,
      }),
      90,
      now,
    );
    expect(result.owned).toBe(false);
    expect(result.basis).toMatch(/Stale SAL/);
  });
});

describe("pre-check", () => {
  it("evaluates signals in the playbook's declared order (support before customer)", () => {
    const result = runPrecheck({
      release: seedRelease,
      assessment: assessment({ intent: "support" }),
      snapshot: snapshot({
        lifecycle: "customer",
        owner: "csm.one@builder.io",
        customer: true,
      }),
      country: "US",
      now,
    });
    expect(result.outcome).toBe("route_to_support");
    expect(result.signal).toBe("support_request");
  });

  it("runs the compliance tier first when a country is restricted", () => {
    const release = releaseWith("rule.precheck.restricted_countries", {
      countries: ["XX"],
    });
    const result = runPrecheck({
      release,
      assessment: assessment({ intent: "support" }),
      snapshot: snapshot(),
      country: "xx",
      now,
    });
    expect(result.outcome).toBe("disqualify_logged");
    expect(result.signal).toBe("restricted_country");
  });

  it("records open items instead of guessing", () => {
    const result = runPrecheck({
      release: seedRelease,
      assessment: assessment(),
      snapshot: snapshot(),
      country: "US",
      now,
    });
    const codes = result.openItems.map((item) => item.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "restricted_countries_unconfirmed",
        "active_conversation_undefined",
        "undeliverable_email_unmapped",
        "open_work_policy_undefined",
      ]),
    );
    const active = result.evaluated.find(
      (item) => item.signal === "active_conversation",
    );
    expect(active?.matched).toBeNull();
    expect(result.outcome).toBe("continue");
  });

  it("flags an intent with no playbook mapping", () => {
    const result = runPrecheck({
      release: seedRelease,
      assessment: assessment({ intent: "job_seeker" }),
      snapshot: snapshot(),
      country: "US",
      now,
    });
    expect(result.outcome).toBe("continue");
    expect(result.openItems.map((item) => item.code)).toContain(
      "intent_without_mapping",
    );
  });
});

describe("routing", () => {
  it("orders relationship state: owned, open deal, customer, churned, agency, new", () => {
    const base = { accountAgencyFlag: false, staleDays: 90, now };
    expect(
      relationshipStateFor({
        ...base,
        snapshot: snapshot({
          lifecycle: "SAL",
          owner: "pa.one@builder.io",
          lastActivityDays: 3,
          openDeals: 1,
        }),
        assessment: assessment({ agency_signal: true }),
      }).state,
    ).toBe("owned");
    expect(
      relationshipStateFor({
        ...base,
        snapshot: snapshot({ openDeals: 1, customer: true }),
        assessment: assessment(),
      }).state,
    ).toBe("open_deal");
    expect(
      relationshipStateFor({
        ...base,
        snapshot: snapshot({ customer: true }),
        assessment: assessment(),
      }).state,
    ).toBe("customer");
    expect(
      relationshipStateFor({
        ...base,
        snapshot: snapshot(),
        assessment: assessment({ agency_signal: true }),
      }).state,
    ).toBe("agency");
    expect(
      relationshipStateFor({
        ...base,
        snapshot: snapshot(),
        assessment: assessment(),
      }).state,
    ).toBe("new");
  });

  it("prefers pool members in working hours, then the fewest assignments", () => {
    const early = new Date("2026-09-29T14:30:00Z"); // 07:30 PT, 10:30 ET
    expect(
      pickRoundRobin({ pool, profiles, assignmentCounts: {}, now: early }).owner
        ?.id,
    ).toBe("p2");
    expect(
      pickRoundRobin({ pool, profiles, assignmentCounts: { p1: 2 }, now }).owner
        ?.id,
    ).toBe("p2");
    expect(
      pickRoundRobin({ pool, profiles, assignmentCounts: {}, now }).owner?.id,
    ).toBe("p1");
  });

  function routeAgency(release = seedRelease) {
    const assess = assessment({ agency_signal: true });
    const precheck = runPrecheck({
      release,
      assessment: assess,
      snapshot: snapshot(),
      country: "US",
      now,
    });
    return routeEngagement({
      release,
      precheck,
      assessment: assess,
      snapshot: snapshot(),
      accountAgencyFlag: false,
      profiles,
      assignmentCounts: {},
      devPool: pool,
      now,
    });
  }

  it("falls through to round robin when the agency partner rep is not set", () => {
    const result = routeAgency();
    expect(result.route).toBe("round_robin");
    expect(result.reason).toMatch(/no partner rep/);
    expect(result.openItems.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "agency_partner_rep_unset",
        "routing_pool_empty",
      ]),
    );
  });

  it("routes agencies to the partner rep once the playbook names one", () => {
    const result = routeAgency(
      releaseWith("rule.routing.order", {
        agency_partner_rep: "partners@pa-dev.example.com",
      }),
    );
    expect(result.route).toBe("agency_partner_rep");
    expect(result.owner?.displayName).toBe("Partner Rep");
    expect(result.reason).toBe(
      "Agency for an unnamed client, routed to the partner rep",
    );
  });
});

describe("scorecard", () => {
  function score(assess: AssessmentInput, snap: CrmSnapshot, flagged = false) {
    const precheck = runPrecheck({
      release: seedRelease,
      assessment: assess,
      snapshot: snap,
      country: "US",
      now,
    });
    const routing = routeEngagement({
      release: seedRelease,
      precheck,
      assessment: assess,
      snapshot: snap,
      accountAgencyFlag: false,
      profiles,
      assignmentCounts: {},
      devPool: pool,
      now,
    });
    return scoreEngagement({
      release: seedRelease,
      precheck,
      routing,
      assessment: assess,
      assessmentId: "a1",
      assessedAt: now.toISOString(),
      snapshot: snap,
      identity: resolveIdentity({
        email: "lead@acme.example.com",
        company: "Acme",
      }),
      submissionId: "s1",
      submittedAt: now.toISOString(),
      untrustedFlagged: flagged,
    });
  }

  it("answers the eight matrix questions, each with a source or an explicit unknown", () => {
    const result = score(assessment(), snapshot());
    expect(result.answers.map((answer) => answer.question)).toEqual([
      "Q1",
      "Q2",
      "Q3",
      "Q4",
      "Q5",
      "Q8",
      "Q11",
      "Q12",
    ]);
    for (const answer of result.answers) {
      expect(
        answer.known
          ? answer.source !== null
          : answer.answer.startsWith("unknown"),
      ).toBe(true);
    }
  });

  it("sizes an agency buying for an unnamed client as unknown until the client is named", () => {
    const result = score(assessment({ agency_signal: true }), snapshot());
    const q8 = result.answers.find((answer) => answer.question === "Q8");
    expect(q8?.answer).toBe("unknown until the client is named");
    expect(result.hypothesis.entry.id).toBe("rule.enterprise.bar");
    expect(result.reasonCodes.map((reason) => reason.code)).toContain(
      "enterprise_fit_unknown_until_client_named",
    );
  });

  it("cites def entries for every verdict", () => {
    for (const assess of [
      assessment(),
      assessment({ intent: "other" }),
      assessment({ intent: "educational" }),
    ]) {
      const result = score(assess, snapshot());
      expect(
        result.reasonCodes.some((reason) => reason.entry.id.startsWith("def.")),
      ).toBe(true);
      expect(result.suggested).toBe(true);
    }
  });

  it("recycles a message with no sales request and notes the review flag", () => {
    const result = score(assessment({ intent: "other" }), snapshot(), true);
    expect(result.verdict).toBe("recycle");
    expect(result.notes[0]).toMatch(/flagged for review/);
  });
});
