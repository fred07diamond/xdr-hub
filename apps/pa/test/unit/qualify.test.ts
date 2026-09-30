// The Contact Sales class (D61), from the xDR master instructions' criteria,
// and the lead brief's CRM note.
import { describe, expect, it } from "vitest";

import { crmNote, leadBriefSchema } from "../../server/core/brief/index.js";
import { contactSalesClass } from "../../server/core/qualify/index.js";

const base = {
  message: null,
  useCase: null,
  jobTitle: null,
  breeze: null,
  employees: null,
  annualRevenue: null,
  productInterest: null,
  agencySignal: false,
};

describe("contactSalesClass", () => {
  it("makes a detailed CMS replatform at an enterprise Highly Qualified Content", () => {
    const result = contactSalesClass({
      ...base,
      message:
        "We are replatforming our marketing site to Next.js with a Storybook design system. Our content team of 12 editors manages about 400 landing pages and needs to launch by Q1.",
      useCase: "Headless CMS",
      employees: 5000,
    });
    expect(result.approach).toBe("hq_content");
    expect(result.criteria.every((item) => item.met !== false)).toBe(true);
  });

  it("keeps a vague CMS ask Standard Content, and never downgrades on title", () => {
    const result = contactSalesClass({
      ...base,
      message: "We want a new content management system for the whole site.",
      jobTitle: "Intern",
      employees: 300,
    });
    expect(result.approach).toBe("standard_content");
    expect(result.summary).toMatch(/Enterprise only/);
  });

  it("needs all three for Highly Qualified Code, or two at enterprise scale", () => {
    const needAndTitle = {
      ...base,
      message:
        "Our design and engineering teams keep rebuilding prototypes; we need SSO and a design system in the codebase.",
      jobTitle: "Director of Engineering",
    };
    expect(contactSalesClass({ ...needAndTitle, breeze: 6 }).approach).toBe(
      "hq_code",
    );
    expect(
      contactSalesClass({ ...needAndTitle, breeze: 3, employees: 400 })
        .approach,
    ).toBe("standard_code");
    expect(
      contactSalesClass({
        ...needAndTitle,
        jobTitle: "Software Engineer",
        employees: 8000,
      }).approach,
    ).toBe("hq_code");
  });

  it("routes agencies first", () => {
    expect(
      contactSalesClass({
        ...base,
        message: "We're building a site for a client in retail.",
      }).approach,
    ).toBe("agency");
  });
});

describe("the CRM note", () => {
  it("formats the master instructions' note and leaves out empty fields", () => {
    const brief = leadBriefSchema.parse({
      summary: "Director of Eng at a 400 person SaaS asking about SSO.",
      persona: "eng",
      deal_role: "likely_buyer",
      use_case: "collaborative_build",
      path_to_engineering: "They are engineering",
      enterprise_signals: ["SSO required"],
      gates: [
        {
          gate: "pain",
          status: "gap",
          evidence: "Not named yet",
          next_move: "Ask about rebuilds",
        },
        { gate: "champion", status: "unknown", evidence: "One contact so far" },
        { gate: "next_step", status: "gap", evidence: "No meeting yet" },
        { gate: "enterprise_need", status: "gap", evidence: "1 signal (SSO)" },
        { gate: "metrics", status: "unknown", evidence: "None yet" },
      ],
      next_step: "Send the qualifying email",
    });
    const note = crmNote(brief, {
      company: "Example Co",
      contact: "Sam Lee, Director of Engineering",
      source: "Contact Sales",
    });
    expect(note).toMatch(/^Lead summary so far: Director of Eng/);
    expect(note).toContain("Persona: Eng");
    expect(note).toContain("Stage 1 Gate Status:");
    expect(note).toContain(
      "- Mutually identified pain we can solve: Gap. Not named yet Next: Ask about rebuilds",
    );
    expect(note).not.toContain("Scope:");
  });

  it("requires all five gates, once each", () => {
    expect(
      leadBriefSchema.safeParse({
        summary: "x",
        persona: "eng",
        deal_role: "coach",
        use_case: "unknown",
        gates: [],
        next_step: "x",
      }).success,
    ).toBe(false);
  });
});
