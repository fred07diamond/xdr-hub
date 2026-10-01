// Lead routing (D66, D78): after triage, who takes the meeting and whose link
// the email carries. The owner is the PA; the route is separate.
import { describe, expect, it } from "vitest";

import {
  DEFAULT_ROUTE_BY_CLASS,
  draftRouteOf,
  leadRouteFor,
  nextEnterpriseAe,
  type LeadRouteInput,
} from "../../server/core/lead-route/index.js";
import type { PersonRecord } from "../../server/core/repo/types.js";

const person = (
  email: string,
  role: PersonRecord["role"],
  extra: Partial<PersonRecord> = {},
): PersonRecord => ({
  email,
  displayName: email.split("@")[0],
  role,
  meetingLink: `https://meetings.example.com/${email.split("@")[0]}`,
  podAeEmail: null,
  updatedBy: "test",
  createdAt: "2026-09-30T00:00:00Z",
  updatedAt: "2026-09-30T00:00:00Z",
  ...extra,
});

const people = [
  person("pa@example.com", "pa"),
  person("ent-a@example.com", "ae"),
  person("ent-b@example.com", "ae"),
  person("commercial-ae@example.com", "commercial_ae"),
  person("account-ae@example.com", "ae"),
];

const NEXT = { email: "ent-a@example.com", name: "ent-a" };

const base: LeadRouteInput = {
  precheckOutcome: "continue",
  signal: null,
  approach: "hq_code",
  hasOpenDeal: false,
  isCustomer: false,
  isAgency: false,
  paOwner: { email: "pa@example.com", name: "Pat" },
  accountOwner: null,
  dealOwner: null,
  people,
  byClass: DEFAULT_ROUTE_BY_CLASS,
  override: null,
  employees: 20000,
  commercialMaxEmployees: 8000,
  enterprise: { assigned: null, next: NEXT },
};

describe("leadRouteFor", () => {
  it("steps back when an AE owns the account, whatever the class or size (D80)", () => {
    for (const input of [
      {},
      { approach: "standard_code" },
      { employees: 520 },
      { hasOpenDeal: true },
    ]) {
      const route = leadRouteFor({
        ...base,
        ...input,
        accountOwner: { email: "account-ae@example.com", name: "Alex" },
      });
      expect(route.route).toBe("ae_owned");
      expect(route.meetingWith).toBeNull();
      expect(draftRouteOf(route).needsLink).toBe(false);
    }
    // An owner Lead routing does not know is flagged, and PA keeps working.
    const unknown = leadRouteFor({
      ...base,
      accountOwner: { email: "someone@example.com", name: "Sam" },
    });
    expect(unknown.route).toBe("route_to_ae");
    expect(unknown.gaps[0]).toMatch(/not set up in Lead routing/);
  });

  it("round robins an unowned account over 8,000 employees to an Enterprise AE (D78)", () => {
    const route = leadRouteFor(base);
    expect(route.segment).toBe("enterprise");
    expect(route.meetingWith?.email).toBe("ent-a@example.com");
    expect(route.roundRobin).toBe("pending");
    // Once saved, the lead keeps its AE.
    const kept = leadRouteFor({
      ...base,
      enterprise: {
        assigned: { email: "ent-b@example.com", name: null },
        next: NEXT,
      },
    });
    expect(kept.meetingWith?.email).toBe("ent-b@example.com");
    expect(kept.roundRobin).toBe("assigned");
    // An account owned by the PA themself is not owned by an AE.
    expect(
      leadRouteFor({
        ...base,
        accountOwner: { email: "pa@example.com", name: "Pat" },
      }).meetingWith?.email,
    ).toBe("ent-a@example.com");
  });

  it("picks the Enterprise AE given the fewest leads, then the longest ago", () => {
    expect(nextEnterpriseAe(people, [])?.email).toBe("account-ae@example.com");
    const assignments = [
      { aeEmail: "account-ae@example.com", assignedAt: "2026-10-01T10:00:00Z" },
      { aeEmail: "ent-a@example.com", assignedAt: "2026-10-01T11:00:00Z" },
      { aeEmail: "ent-b@example.com", assignedAt: "2026-10-01T09:00:00Z" },
    ];
    expect(nextEnterpriseAe(people, assignments)?.email).toBe(
      "ent-b@example.com",
    );
    // A refresh's copy is the same lead, so it does not count again.
    expect(
      nextEnterpriseAe(people, [
        ...assignments,
        {
          aeEmail: "ent-b@example.com",
          assignedAt: "2026-10-01T12:00:00Z",
          method: "carried",
        },
      ])?.email,
    ).toBe("ent-b@example.com");
    expect(nextEnterpriseAe([person("pa@example.com", "pa")], [])).toBeNull();
  });

  it("says what is missing instead of guessing", () => {
    const none = leadRouteFor({
      ...base,
      people: [person("pa@example.com", "pa")],
      enterprise: { assigned: null, next: null },
    });
    expect(none.meetingWith).toBeNull();
    expect(none.needs).toBe("enterprise_ae");
    expect(none.gaps[0]).toMatch(/No enterprise AEs/);
    const noLink = leadRouteFor({
      ...base,
      people: [
        person("pa@example.com", "pa"),
        person("ent-a@example.com", "ae", { meetingLink: null }),
      ],
    });
    expect(noLink.meetingWith?.link).toBeNull();
    expect(noLink.gaps[0]).toMatch(/No meeting link/);
    expect(draftRouteOf(noLink)).toMatchObject({ needsLink: true, link: null });
    // An unknown size goes to the round robin, flagged.
    const unknown = leadRouteFor({ ...base, employees: null });
    expect(unknown.meetingWith?.email).toBe("ent-a@example.com");
    expect(unknown.gaps[0]).toMatch(/Employee count unknown/);
  });

  it("qualifies a Standard lead first, and the PA can take the call", () => {
    const standard = leadRouteFor({ ...base, approach: "standard_code" });
    expect(standard.route).toBe("qualify_first");
    expect(draftRouteOf(standard).needsLink).toBe(false);
    const taken = leadRouteFor({
      ...base,
      approach: "standard_code",
      override: "pa_meeting",
    });
    expect(taken.route).toBe("pa_meeting");
    expect(taken.source).toBe("override");
    expect(taken.meetingWith).toMatchObject({
      email: "pa@example.com",
      role: "pa",
    });
  });

  it("keeps the exits out of the PA's hands", () => {
    expect(
      leadRouteFor({ ...base, precheckOutcome: "route_to_support" }).route,
    ).toBe("no_sales_email");
    expect(
      leadRouteFor({ ...base, isCustomer: true, override: "pa_meeting" }).route,
    ).toBe("customer_team");
    expect(
      leadRouteFor({
        ...base,
        hasOpenDeal: true,
        dealOwner: { email: "account-ae@example.com", name: "Alex" },
      }).meetingWith?.email,
    ).toBe("account-ae@example.com");
    expect(leadRouteFor({ ...base, isAgency: true }).route).toBe("agency");
  });

  it("sends one clarification email when the class suggests a recycle", () => {
    const route = leadRouteFor({
      ...base,
      approach: "standard_content",
      suggestRecycle: true,
    });
    expect(route.route).toBe("clarify_once");
    expect(draftRouteOf(route).needsLink).toBe(false);
    // The PA can still take the call, and an exceptional lead is never sent here.
    expect(
      leadRouteFor({ ...base, suggestRecycle: true, override: "pa_meeting" })
        .route,
    ).toBe("pa_meeting");
  });

  it("sends an unowned account of 8,000 employees or fewer to the Commercial AE", () => {
    for (const employees of [520, 8000]) {
      const route = leadRouteFor({ ...base, employees });
      expect(route.segment).toBe("commercial");
      expect(route.meetingWith?.email).toBe("commercial-ae@example.com");
      expect(draftRouteOf(route).cc).toBe("commercial-ae@example.com");
    }
    expect(leadRouteFor({ ...base, employees: 8001 }).segment).toBe(
      "enterprise",
    );
    // Owned by an AE: PA steps back, whatever the size.
    expect(
      leadRouteFor({
        ...base,
        employees: 520,
        accountOwner: { email: "account-ae@example.com", name: "Alex" },
      }).route,
    ).toBe("ae_owned");
    // No Commercial AE set: say so, and ask for one.
    const missing = leadRouteFor({
      ...base,
      employees: 520,
      people: people.filter((item) => item.role !== "commercial_ae"),
    });
    expect(missing.meetingWith).toBeNull();
    expect(missing.needs).toBe("commercial_ae");
    expect(missing.gaps[0]).toMatch(/No commercial AE/);
  });

  it("routes an exceptional partnership ask to Partnerships, and recycles the rest (D81)", () => {
    const withPartners = [
      ...people,
      person("partners@example.com", "partnerships"),
    ];
    const exceptional = leadRouteFor({
      ...base,
      people: withPartners,
      partnershipAsk: true,
      partnershipTier: "exceptional",
    });
    expect(exceptional.route).toBe("partnerships");
    expect(exceptional.meetingWith?.email).toBe("partners@example.com");
    expect(draftRouteOf(exceptional)).toMatchObject({
      needsLink: true,
      cc: "partners@example.com",
    });
    const less = leadRouteFor({
      ...base,
      people: withPartners,
      partnershipAsk: true,
      partnershipTier: "discovery",
    });
    expect(less.route).toBe("partnership_recycle");
    expect(draftRouteOf(less).needsLink).toBe(false);
    // No Partnerships contact yet: say so, and ask for one.
    const missing = leadRouteFor({
      ...base,
      partnershipAsk: true,
      partnershipTier: "exceptional",
    });
    expect(missing.needs).toBe("partnerships");
    // An AE-owned account is still left to HubSpot first.
    expect(
      leadRouteFor({
        ...base,
        people: withPartners,
        partnershipAsk: true,
        partnershipTier: "exceptional",
        accountOwner: { email: "account-ae@example.com", name: "Alex" },
      }).route,
    ).toBe("ae_owned");
  });

  it("follows the playbook's routing rule", () => {
    const route = leadRouteFor({
      ...base,
      approach: "standard_content",
      byClass: { ...DEFAULT_ROUTE_BY_CLASS, standard_content: "pa_meeting" },
    });
    expect(route.route).toBe("pa_meeting");
  });
});
