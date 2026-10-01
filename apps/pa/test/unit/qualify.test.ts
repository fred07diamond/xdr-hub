// The Contact Sales class (D67): Exceptional (3 of 5 signals, route to the
// AE) or Requires discovery, with an intent score of 0 or 1 suggesting a
// recycle. Agencies route first.
import { describe, expect, it } from "vitest";

import {
  contactSalesClass,
  type QualifyInput,
} from "../../server/core/qualify/index.js";

const base: QualifyInput = {
  message: "Looking at Builder for our team.",
  useCase: "Webapps",
  jobTitle: "Engineer",
  breeze: 4,
  employees: 40,
  annualRevenue: null,
  productInterest: null,
  agencySignal: false,
  budgetStatus: null,
  signupContacts: 1,
};

const met = (input: Partial<QualifyInput>) =>
  contactSalesClass({ ...base, ...input })
    .criteria.filter((item) => item.met === true)
    .map((item) => item.label);

describe("contactSalesClass", () => {
  it("needs 3 of the 5 signals for Exceptional", () => {
    const strong = contactSalesClass({
      ...base,
      breeze: 8,
      message: "We need SSO and RBAC across 12 teams on our design system.",
      employees: 2500,
    });
    expect(strong.tier).toBe("exceptional");
    expect(strong.approach).toBe("hq_code");
    expect(strong.label).toBe("Exceptional, Code");
    expect(strong.signalsMet).toBe(3);

    const two = contactSalesClass({ ...base, breeze: 8, employees: 2500 });
    expect(two.tier).toBe("discovery");
    expect(two.label).toBe("Requires discovery, Code");
  });

  it("reads each signal at the playbook's lines", () => {
    expect(met({ breeze: 6 })).toContain("Intent score 6 or more");
    expect(met({ breeze: 5 })).not.toContain("Intent score 6 or more");
    expect(met({ employees: 101 })).toContain("100+ employees");
    expect(met({ employees: 100 })).not.toContain("100+ employees");
    expect(met({ budgetStatus: "Approved" })).toContain(
      "Clearly defined budget",
    );
    expect(met({ budgetStatus: "Unsure" })).not.toContain(
      "Clearly defined budget",
    );
    expect(met({ signupContacts: 3 })).toContain(
      "Multiple sign-ups from the account",
    );
    expect(
      met({ message: "Replatforming 40 sites onto a headless CMS" }),
    ).toContain("Clear enterprise need in the message");
  });

  it("says unknown instead of guessing", () => {
    const value = contactSalesClass({
      ...base,
      breeze: null,
      employees: null,
      signupContacts: null,
    });
    const unknown = value.criteria
      .filter((item) => item.met === null)
      .map((item) => item.label);
    expect(unknown).toEqual([
      "100+ employees",
      "Clearly defined budget",
      "Multiple sign-ups from the account",
    ]);
    expect(value.tier).toBe("discovery");
    // No intent score counts as 0 (D71), so it suggests a recycle.
    expect(value.criteria[0]).toMatchObject({ met: false });
    expect(value.suggestRecycle).toBe(true);
  });

  it("suggests a recycle at an intent score of 0 or 1", () => {
    const low = contactSalesClass({ ...base, breeze: 1 });
    expect(low.suggestRecycle).toBe(true);
    expect(low.label).toBe("Requires discovery, Code, suggest recycle");
    expect(contactSalesClass({ ...base, breeze: 2 }).suggestRecycle).toBe(
      false,
    );
  });

  it("keeps Content and Code for the email angle, and agencies first", () => {
    expect(
      contactSalesClass({ ...base, useCase: "Headless CMS" }).approach,
    ).toBe("standard_content");
    expect(
      contactSalesClass({ ...base, message: "Building this for a client" })
        .approach,
    ).toBe("agency");
  });

  it("follows thresholds edited in the playbook", () => {
    const value = contactSalesClass({
      ...base,
      breeze: 8,
      employees: 2500,
      thresholds: { exceptional_signals: 2 },
    });
    expect(value.tier).toBe("exceptional");
  });
});
