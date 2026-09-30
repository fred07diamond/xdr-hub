// The Contact Sales class (D61, from the xDR master instructions): Content or
// Code first, then Highly Qualified or Standard by the project's criteria,
// with agencies routed first. Deterministic and explained, so the rep sees
// why, and the drafting agent starts from it instead of guessing. The agent
// may disagree with evidence; the draft records the class it used.
import { APPROACH_LABELS, type Approach } from "../drafting/index.js";

export interface QualifyInput {
  message: string | null;
  /** HubSpot "What is your use case [Contact Sales]". */
  useCase: string | null;
  jobTitle: string | null;
  breeze: number | null;
  /** The company's HubSpot employee count, else the form's company size. */
  employees: number | null;
  annualRevenue: number | null;
  productInterest: string | null;
  agencySignal: boolean;
}

export interface Criterion {
  label: string;
  met: boolean | null;
  evidence: string;
}

export interface ContactSalesClass {
  approach: Approach;
  label: string;
  product: "content" | "code";
  criteria: Criterion[];
  summary: string;
}

const CONTENT_USE_CASES = new Set(["headless cms", "landing pages"]);
const CODE_USE_CASES = new Set([
  "webapps",
  "prototypes",
  "design to code",
  "agent-native apps",
]);

const CONTENT_WORDS =
  /\b(cms|headless|content management|marketing site|landing pages?|publishing|content team|build pages|web estate|website)\b/i;
const CODE_WORDS =
  /\b(codebase|repo|react|next\.?js|vue|angular|figma|design system|components?|frontend|front-end|developers?|engineering|cursor|copilot|claude code|prototyp|web ?apps?)\b/i;
const AGENCY_WORDS =
  /\b(our clients?|a client|client project|for a client|agency|consultancy|system integrator|dev shop)\b/i;
const MANAGER_TITLE =
  /\b(manager|director|vp|vice president|head of|chief|cto|cpo|cmo|ceo|cio|cdo|cxo|principal|staff|founder|co-founder|president|group product|lead)\b/i;
const CODE_ENTERPRISE_NEED =
  /\b(design system|sso|saml|rbac|access control|security|compliance|at scale|across teams|collaborat|codebase|governance|seats?|enterprise|cursor|copilot|claude code|handoff|rebuild)\b/i;
const SPECIFIC_INITIATIVE =
  /\b(replatform|migrat|moving (our|to)|redesign|next\.?js|storybook|design system|contentful|sanity|wordpress|aem|sitecore|contentstack|drupal|webflow|workflows?|teams?)\b/i;

/** The five Standard Content discovery questions, by what answers each. */
const CONTENT_QUESTIONS: Array<{ label: string; pattern: RegExp }> = [
  {
    label: "page count or scope",
    pattern: /\b\d[\d,]*\s*(pages|sites)\b|entire (web|site)|web estate/i,
  },
  {
    label: "team structure",
    pattern:
      /\b(\d+\s*(editors|marketers|people|developers)|team of|marketing team|content team)\b/i,
  },
  {
    label: "current setup",
    pattern:
      /\b(currently|today we|we use|using|from|moving|migrat|replatform|contentful|wordpress|aem|sitecore|sanity|drupal)\b/i,
  },
  {
    label: "page types",
    pattern:
      /\b(landing|pdp|product pages?|blog|docs|documentation|marketing site|course|storefront|e-?commerce)\b/i,
  },
  {
    label: "timeline or initiative",
    pattern:
      /\b(q[1-4]|quarter|this (month|year)|next (month|year)|deadline|launch|by (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|20\d\d)\b/i,
  },
];

const words = (text: string | null) =>
  (text ?? "").split(/\s+/).filter(Boolean).length;

export function contactSalesClass(input: QualifyInput): ContactSalesClass {
  const message = input.message ?? "";
  const useCase = input.useCase?.trim().toLowerCase() ?? "";
  const enterpriseScale =
    (input.employees ?? 0) >= 2000 || (input.annualRevenue ?? 0) >= 500_000_000;
  const scaleEvidence = [
    input.employees !== null
      ? `${input.employees.toLocaleString()} employees`
      : null,
    input.annualRevenue !== null
      ? `$${Math.round(input.annualRevenue / 1_000_000)}M revenue`
      : null,
    input.breeze !== null ? `Breeze ${input.breeze}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  // Agencies route first (master instructions: agency routing before class).
  if (input.agencySignal || AGENCY_WORDS.test(message)) {
    return {
      approach: "agency",
      label: APPROACH_LABELS.agency,
      product: CONTENT_WORDS.test(message) ? "content" : "code",
      criteria: [
        {
          label: "Agency or partner-type",
          met: true,
          evidence: input.agencySignal
            ? "The message says they are working for a client"
            : "The message mentions a client or agency",
        },
      ],
      summary:
        "Agency lead: find the path (internal use, a client project, or exploring) first. For a client project, get the client's headcount and HQ before proposing times.",
    };
  }

  const content =
    input.productInterest === "content" ||
    CONTENT_USE_CASES.has(useCase) ||
    (CONTENT_WORDS.test(message) && !CODE_USE_CASES.has(useCase));
  const productEvidence = input.useCase
    ? `Use case on the form: ${input.useCase}`
    : content
      ? "The message is about content or a CMS"
      : "No content or CMS signal, so Code";

  if (content) {
    const answered = CONTENT_QUESTIONS.filter((item) =>
      item.pattern.test(message),
    );
    const detailed = words(message) >= 25 && SPECIFIC_INITIATIVE.test(message);
    const fit = (input.breeze ?? 0) >= 7 || enterpriseScale;
    const criteria: Criterion[] = [
      { label: "Content or CMS lead", met: true, evidence: productEvidence },
      {
        label: "Breeze 7+ or recognizable enterprise",
        met: input.breeze === null && input.employees === null ? null : fit,
        evidence: scaleEvidence || "No Breeze score or company size in HubSpot",
      },
      {
        label: "Detailed message with a specific initiative",
        met: detailed,
        evidence: `${words(message)} words${detailed ? ", names a specific initiative" : ""}`,
      },
      {
        label: "Already answers 2+ of the 5 Content questions",
        met: answered.length >= 2,
        evidence:
          answered.length > 0
            ? `Answers ${answered.map((item) => item.label).join(", ")}`
            : "Answers none of them",
      },
    ];
    const met = criteria.slice(1).filter((item) => item.met).length;
    const hq = met >= 2;
    const unanswered = CONTENT_QUESTIONS.filter(
      (item) => !answered.includes(item),
    ).map((item) => item.label);
    return {
      approach: hq ? "hq_content" : "standard_content",
      label: APPROACH_LABELS[hq ? "hq_content" : "standard_content"],
      product: "content",
      criteria,
      summary: hq
        ? `${met} of 3 met: book it. Acknowledge the initiative, note Content is Enterprise only, offer two times, and ask prep questions only for real gaps.`
        : `${met} of 3 met: acknowledge, note Content is Enterprise only, and ask the Content questions still open (${unanswered.join(", ") || "none"}). No demo on the first touch. Pricing only in the price check, which needs known page views.`,
    };
  }

  const fit = (input.breeze ?? 0) >= 5 || enterpriseScale;
  const senior = MANAGER_TITLE.test(input.jobTitle ?? "");
  const need = CODE_ENTERPRISE_NEED.test(message);
  const criteria: Criterion[] = [
    { label: "Code lead", met: true, evidence: productEvidence },
    {
      label: "Breeze 5+ or recognizable enterprise",
      met: input.breeze === null && input.employees === null ? null : fit,
      evidence: scaleEvidence || "No Breeze score or company size in HubSpot",
    },
    {
      label: "Manager-level title or above",
      met: input.jobTitle ? senior : null,
      evidence: input.jobTitle ?? "No job title on the form or in HubSpot",
    },
    {
      label: "A specific enterprise-relevant need in the message",
      met: need,
      evidence: need
        ? "The message names an enterprise need (design system, security, collaboration at scale, or AI tooling)"
        : "No enterprise need named yet",
    },
  ];
  const met = criteria.slice(1).filter((item) => item.met).length;
  // All three, or two of three on a clearly enterprise-scale account.
  const hq = met === 3 || (met === 2 && enterpriseScale);
  return {
    approach: hq ? "hq_code" : "standard_code",
    label: APPROACH_LABELS[hq ? "hq_code" : "standard_code"],
    product: "code",
    criteria,
    summary: hq
      ? "Book it: acknowledge the request, one line of value, two time options, then prep questions led by a pain hypothesis (is engineering in the loop, Cursor or Copilot, enterprise signals)."
      : "Qualify first: acknowledge, one line of value, 2 or 3 questions that probe for enterprise signals and a path to engineering, then a soft offer to find time. Company size alone does not decide enterprise need.",
  };
}
