// Lead routing (D66): after triage, who takes the meeting and whose link the
// email carries. The owner is the PA; the route is separate.
import { describe, expect, it } from "vitest";

import {
  DEFAULT_ROUTE_BY_CLASS,
  draftRouteOf,
  leadRouteFor,
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
  person("pa@example.com", "pa", { podAeEmail: "pod-ae@example.com" }),
  person("pod-ae@example.com", "ae"),
  person("account-ae@example.com", "ae"),
];

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
};

describe("leadRouteFor", () => {
  it("sends an enterprise fit to the account's AE, with that AE's link", () => {
    const route = leadRouteFor({
      ...base,
      accountOwner: { email: "account-ae@example.com", name: "Alex" },
    });
    expect(route.route).toBe("route_to_ae");
    expect(route.meetingWith).toMatchObject({
      email: "account-ae@example.com",
      role: "ae",
      link: "https://meetings.example.com/account-ae",
    });
    expect(route.gaps).toEqual([]);
  });

  it("falls back to the PA's pod AE when the account has no AE", () => {
    const route = leadRouteFor(base);
    expect(route.meetingWith?.email).toBe("pod-ae@example.com");
    // An account owned by the PA themself is not an AE.
    const own = leadRouteFor({
      ...base,
      accountOwner: { email: "pa@example.com", name: "Pat" },
    });
    expect(own.meetingWith?.email).toBe("pod-ae@example.com");
  });

  it("says what is missing instead of guessing", () => {
    const noPod = leadRouteFor({
      ...base,
      people: [person("pa@example.com", "pa")],
    });
    expect(noPod.meetingWith).toBeNull();
    expect(noPod.gaps[0]).toMatch(/pod AE/);
    const noLink = leadRouteFor({
      ...base,
      people: [
        person("pa@example.com", "pa", { podAeEmail: "pod-ae@example.com" }),
        person("pod-ae@example.com", "ae", { meetingLink: null }),
      ],
    });
    expect(noLink.meetingWith?.link).toBeNull();
    expect(noLink.gaps[0]).toMatch(/No meeting link/);
    expect(draftRouteOf(noLink)).toMatchObject({ needsLink: true, link: null });
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

  it("follows the playbook's routing rule", () => {
    const route = leadRouteFor({
      ...base,
      approach: "standard_content",
      byClass: { ...DEFAULT_ROUTE_BY_CLASS, standard_content: "pa_meeting" },
    });
    expect(route.route).toBe("pa_meeting");
  });
});
