// The Contact Sales class (D67): Exceptional or Requires discovery, from five
// signals in the playbook's qualification rule. Exceptional routes to the AE;
// Requires discovery is qualified first. Content or Code only picks the email
// angle. Agencies route first. Deterministic and explained, so the rep sees
// why, and the drafting agent starts from it instead of guessing.
import { APPROACH_LABELS, type Approach } from "../drafting/index.js";
import type { PlaybookRelease } from "../playbook/schema.js";

export interface QualifyThresholds {
  /** Signals needed for Exceptional. */
  exceptional_signals: number;
  /** Intent score (Breeze fit, 0 to 10) at or above this is an exceptional signal. */
  intent_exceptional: number;
  /** Intent score at or below this suggests a recycle. */
  intent_recycle: number;
  /** Employees at or above this is an exceptional signal. */
  employees_exceptional: number;
  /** Sign-up contacts on the account at or above this is an exceptional signal. */
  signups_multiple: number;
  /** A message under this many words, with no question, is too thin (D88). */
  thin_message_words: number;
}

export const DEFAULT_THRESHOLDS: QualifyThresholds = {
  exceptional_signals: 3,
  intent_exceptional: 6,
  intent_recycle: 1,
  employees_exceptional: 101,
  signups_multiple: 2,
  thin_message_words: 8,
};

/** The playbook's qualification thresholds (D67), or the defaults. */
export function qualifyThresholds(
  release: PlaybookRelease | null | undefined,
): Partial<QualifyThresholds> {
  const entry = release?.entries.find(
    (item) => item.id === "rule.qualify.tiers",
  );
  if (!entry || entry.status === "retired") return {};
  return Object.fromEntries(
    Object.entries(entry.params ?? {}).filter(
      ([key, value]) => key in DEFAULT_THRESHOLDS && typeof value === "number",
    ),
  ) as Partial<QualifyThresholds>;
}

export interface QualifyInput {
  message: string | null;
  /** HubSpot "What is your use case [Contact Sales]". */
  useCase: string | null;
  jobTitle: string | null;
  /** The intent score: HubSpot's Company Fit Score (Breeze), 0 to 10. */
  breeze: number | null;
  /** The company's HubSpot employee count, else the form's company size. */
  employees: number | null;
  annualRevenue: number | null;
  productInterest: string | null;
  agencySignal: boolean;
  /** The form's "Budget status for dev tools this year". */
  budgetStatus?: string | null;
  /** Sign-up contacts on the account (company: Number of Associated Sign Up Contacts). */
  signupContacts?: number | null;
  thresholds?: Partial<QualifyThresholds>;
  /** Judge the tier even for an agency, as for a partnership ask (D81). */
  skipAgency?: boolean;
}

/**
 * A partnership ask (D81): they want to partner with Builder, not buy it.
 * Plain "partner" is not enough; agencies and buyers say it too.
 */
const PARTNERSHIP =
  /\b(partnership|partnering|partner with (you|builder|your team)|become an? (\w+ )?partner|partner program|reseller|resell(ing)? builder|affiliate|referral partner|co-?marketing|co-?selling|alliance|technology partner|integration partner|channel partner)\b/i;

export function isPartnershipAsk(message: string | null | undefined) {
  return PARTNERSHIP.test(message ?? "");
}

export interface Criterion {
  label: string;
  met: boolean | null;
  evidence: string;
}

export type QualifyTier = "exceptional" | "discovery";

export interface ContactSalesClass {
  approach: Approach;
  label: string;
  product: "content" | "code";
  tier: QualifyTier | null;
  /** Intent score at or under the recycle line: PA suggests a recycle. */
  suggestRecycle: boolean;
  /** A few words, no question, next to no signal (D88). */
  thin?: boolean;
  signalsMet: number;
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
const AGENCY_WORDS =
  /\b(our clients?|a client|client project|for a client|agency|consultancy|system integrator|dev shop)\b/i;
/** A clear enterprise need in their own words (Sales handbook 02 signals). */
const ENTERPRISE_NEED =
  /\b(enterprise|design system|sso|saml|rbac|role.based|access control|security review|compliance|soc ?2|hipaa|gdpr|governance|audit|at scale|across (\d+ )?(teams|brands|sites|regions|markets)|multiple (teams|brands|sites|regions|markets)|\d{2,}\+? (seats|developers|engineers|editors|users|pages|sites)|self.hosted|vpc|on.prem|sla|replatform|migrat\w*|localization|multi.?brand|multi.?site)\b/i;
const BUDGET_WORDS =
  /(\$\s?\d|\b\d+\s?k\b|\bbudget (is |was )?(approved|allocated|set|secured)|\bbudgeted\b|\bprocurement\b|\bpurchase order\b|\bpo\b)/i;

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

export function contactSalesClass(input: QualifyInput): ContactSalesClass {
  const t = { ...DEFAULT_THRESHOLDS, ...(input.thresholds ?? {}) };
  const message = input.message ?? "";
  const useCase = input.useCase?.trim().toLowerCase() ?? "";
  const product: "content" | "code" =
    input.productInterest === "content" ||
    CONTENT_USE_CASES.has(useCase) ||
    (CONTENT_WORDS.test(message) && !CODE_USE_CASES.has(useCase))
      ? "content"
      : "code";

  // Agencies route first (master instructions: agency routing before class).
  if (!input.skipAgency && (input.agencySignal || AGENCY_WORDS.test(message))) {
    return {
      approach: "agency",
      label: APPROACH_LABELS.agency,
      product,
      tier: null,
      suggestRecycle: false,
      signalsMet: 0,
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

  const need = ENTERPRISE_NEED.exec(message);
  const budget = input.budgetStatus?.trim() || null;
  const budgetInMessage = BUDGET_WORDS.test(message);
  const criteria: Criterion[] = [
    {
      label: `Intent score ${t.intent_exceptional} or more`,
      // No score counts as 0 (D71): unscored leads are not given the benefit.
      met: (input.breeze ?? 0) >= t.intent_exceptional,
      evidence:
        input.breeze === null
          ? "No intent score (Breeze fit) in HubSpot, counted as 0"
          : `Intent score ${input.breeze} of 10`,
    },
    {
      label: "Clear enterprise need in the message",
      met: need !== null,
      evidence: need
        ? `They mention "${need[0]}"`
        : message.trim()
          ? "Potential or unclear need: no enterprise signal named yet"
          : "No message on the form",
    },
    {
      label: `${t.employees_exceptional - 1}+ employees`,
      met:
        input.employees === null
          ? null
          : input.employees >= t.employees_exceptional,
      evidence:
        input.employees === null
          ? "Employee count unknown"
          : `${input.employees.toLocaleString()} employees`,
    },
    {
      label: "Clearly defined budget",
      met:
        budget === "Approved" || budgetInMessage
          ? true
          : budget === null
            ? null
            : false,
      evidence: budgetInMessage
        ? "The message names a budget"
        : budget
          ? `Budget status on the form: ${budget}`
          : "Budget unknown; may need research",
    },
    {
      label: "Multiple sign-ups from the account",
      met:
        input.signupContacts === null || input.signupContacts === undefined
          ? null
          : input.signupContacts >= t.signups_multiple,
      evidence:
        input.signupContacts === null || input.signupContacts === undefined
          ? "Sign-ups on the account unknown"
          : `${input.signupContacts} sign-up ${input.signupContacts === 1 ? "contact" : "contacts"} on the account`,
    },
  ];
  const signalsMet = criteria.filter((item) => item.met === true).length;
  const exceptional = signalsMet >= t.exceptional_signals;
  // A thin message (D88): a few words, no question, and next to no signal,
  // such as "yes need a trial". Nothing to qualify, so it suggests a recycle.
  const messageWords = words(message);
  const thin =
    messageWords < t.thin_message_words &&
    !message.includes("?") &&
    signalsMet <= 1;
  const lowIntent = (input.breeze ?? 0) <= t.intent_recycle;
  const suggestRecycle = !exceptional && (lowIntent || thin);
  const approach: Approach =
    product === "content"
      ? exceptional
        ? "hq_content"
        : "standard_content"
      : exceptional
        ? "hq_code"
        : "standard_code";
  const open = criteria
    .filter((item) => item.met !== true)
    .map((item) => item.label.toLowerCase());
  return {
    approach,
    label: suggestRecycle
      ? `${APPROACH_LABELS[approach]}, suggest recycle`
      : APPROACH_LABELS[approach],
    product,
    tier: exceptional ? "exceptional" : "discovery",
    suggestRecycle,
    thin,
    signalsMet,
    criteria,
    summary: exceptional
      ? `${signalsMet} of 5 signals: exceptional. Route to the AE with their meeting link, and ask only about real gaps.`
      : suggestRecycle
        ? `${
            lowIntent
              ? input.breeze === null
                ? "No intent score"
                : `Intent score ${input.breeze}`
              : `A ${messageWords} word message with nothing to qualify`
          }: suggest recycle. One email asking them to clarify what they need, not a sequence (${signalsMet} of 5 signals).`
        : `${signalsMet} of 5 signals: requires discovery. Ask about what is still open (${open.join(", ")}) before routing.`,
  };
}
