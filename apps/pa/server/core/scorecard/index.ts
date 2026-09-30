import type { AssessmentInput } from "../assessment/index.js";
import type { CrmSnapshot } from "../crm/port.js";
import type { ResolvedIdentity } from "../identity/index.js";
import {
  RELATIONSHIP_LABELS,
  type PrecheckOutcome,
  type RelationshipState,
  type Verdict,
} from "../objects/index.js";
import { definition, rule, uniqueCitations } from "../playbook/resolve.js";
import type { Citation, PlaybookRelease } from "../playbook/schema.js";
import type { PrecheckResult } from "../precheck/index.js";
import type { RoutingResult } from "../routing/index.js";

export type Confidence = "high" | "medium" | "low";

export interface AnswerSource {
  kind: "form" | "assessment" | "crm" | "identity" | "playbook";
  ref: string;
  quote?: string;
}

export interface ScorecardAnswer {
  question: string;
  label: string;
  answer: string;
  known: boolean;
  source: AnswerSource | null;
  as_of: string | null;
  confidence: Confidence | null;
  conflicts?: Array<{ source: AnswerSource; value: string }>;
}

export interface ReasonCode {
  code: string;
  entry: Citation;
  detail: string;
}

export interface Hypothesis {
  question: "Q8";
  entity: string;
  statement: string;
  entry: Citation;
}

export interface ScorecardResult {
  verdict: Verdict;
  suggested: true;
  reasonCodes: ReasonCode[];
  answers: ScorecardAnswer[];
  hypothesis: Hypothesis;
  notes: string[];
  citations: Citation[];
}

const PRODUCT_LABELS: Record<string, string> = {
  content: "Content (visual CMS)",
  code: "Code",
  both: "Content and Code",
};

function unknown(
  question: string,
  label: string,
  why: string,
): ScorecardAnswer {
  return {
    question,
    label,
    answer: `unknown: ${why}`,
    known: false,
    source: null,
    as_of: null,
    confidence: null,
  };
}

export function scoreEngagement(input: {
  release: PlaybookRelease;
  precheck: PrecheckResult;
  routing: RoutingResult;
  assessment: AssessmentInput;
  assessmentId: string;
  assessedAt: string;
  snapshot: CrmSnapshot;
  identity: ResolvedIdentity;
  submissionId: string;
  submittedAt: string;
  untrustedFlagged: boolean;
}): ScorecardResult {
  const release = input.release;
  const outcomes = rule(release, "rule.precheck.outcomes");
  const bar = rule(release, "rule.enterprise.bar");
  const defQl = definition(release, "def.ql");
  const defSal = definition(release, "def.sal");
  const defRecycle = definition(release, "def.recycle");
  const defDisqualify = definition(release, "def.disqualify");
  const assessmentSource = (quote?: string): AnswerSource => ({
    kind: "assessment",
    ref: input.assessmentId,
    ...(quote ? { quote } : {}),
  });
  const form: AnswerSource = { kind: "form", ref: input.submissionId };
  const crmRef = input.snapshot.contact?.ref.id ?? "no-crm-contact";
  const crm: AnswerSource = {
    kind: "crm",
    ref: `${input.snapshot.source}:${crmRef}`,
  };

  const answers: ScorecardAnswer[] = [];

  const q1Parts = [
    input.identity.personalDomain
      ? `Personal email domain (${input.identity.domain}); company unverified`
      : `Work email at ${input.identity.domain}`,
    input.identity.companyName
      ? `company given as ${input.identity.companyName}`
      : "no company given",
    "not verified, no enrichment in slice 1",
  ];
  const q1: ScorecardAnswer = {
    question: "Q1",
    label: "Real person, real company",
    answer: q1Parts.join("; "),
    known: true,
    source: form,
    as_of: input.submittedAt,
    confidence: "low",
  };
  const crmCompany = input.snapshot.company?.name;
  if (
    crmCompany &&
    input.identity.companyName &&
    crmCompany !== input.identity.companyName
  ) {
    q1.conflicts = [
      { source: form, value: input.identity.companyName },
      { source: crm, value: crmCompany },
    ];
  }
  answers.push(q1);

  const agencyUnnamed =
    input.assessment.agency_signal && !input.assessment.end_client_named;
  answers.push(
    agencyUnnamed
      ? unknown(
          "Q2",
          "What the company does and at what scale",
          "the buying entity is an unnamed client",
        )
      : unknown(
          "Q2",
          "What the company does and at what scale",
          "no firmographics source in slice 1",
        ),
  );
  answers.push(
    unknown("Q3", "Role", "not on the form and no enrichment in slice 1"),
  );

  const productQuote = input.assessment.evidence_quotes.find((quote) =>
    /code|cms|content|visual|editor/i.test(quote),
  );
  answers.push(
    input.assessment.product_interest === "unknown"
      ? unknown("Q4", "Which product", "the message does not name a product")
      : {
          question: "Q4",
          label: "Which product",
          answer: PRODUCT_LABELS[input.assessment.product_interest],
          known: true,
          source: assessmentSource(productQuote),
          as_of: input.assessedAt,
          confidence: "medium",
        },
  );

  const painQuote =
    input.assessment.intent === "sales"
      ? (input.assessment.evidence_quotes[0] ??
        input.assessment.explicit_question ??
        null)
      : null;
  answers.push(
    painQuote
      ? {
          question: "Q5",
          label: "The pain in their words",
          answer: painQuote,
          known: true,
          source: assessmentSource(painQuote),
          as_of: input.assessedAt,
          confidence: "medium",
        }
      : unknown(
          "Q5",
          "The pain in their words",
          "no sales need stated in the message",
        ),
  );

  const hypothesis: Hypothesis = agencyUnnamed
    ? {
        question: "Q8",
        entity: "unnamed client",
        statement: "unknown until the client is named",
        entry: bar.citation,
      }
    : {
        question: "Q8",
        entity: input.identity.companyName ?? input.identity.domain,
        statement: `unknown: seat count unknown against the ${bar.params.code_min_seats} Code seat bar`,
        entry: bar.citation,
      };
  answers.push({
    question: "Q8",
    label: "Self-serve or enterprise shaped (hypothesis)",
    answer: agencyUnnamed
      ? "unknown until the client is named"
      : hypothesis.statement,
    known: false,
    source: {
      kind: "playbook",
      ref: `${bar.citation.id}@v${bar.citation.version}`,
    },
    as_of: null,
    confidence: null,
  });

  const signal = input.snapshot.contact?.productSignal;
  answers.push(
    signal
      ? {
          question: "Q11",
          label: "Product activity",
          answer: signal,
          known: true,
          source: crm,
          as_of: input.snapshot.fetchedAt,
          confidence: "high",
        }
      : unknown(
          "Q11",
          "Product activity",
          input.snapshot.contact
            ? "no product signal in the CRM snapshot"
            : "no CRM contact",
        ),
  );

  const relationship = input.routing.relationshipState;
  const relationshipDetail: Record<RelationshipState, string> = {
    owned: `Owned: ${input.snapshot.contact?.lifecycleRaw ?? "SAL"} with an active owner`,
    open_deal: `Open deal (${input.snapshot.openDeals.length})`,
    customer: "Customer",
    churned: "Churned",
    agency: "Agency",
    new: "New",
  };
  const agencyNote =
    input.assessment.agency_signal && relationship !== "agency"
      ? "; agency signal in the message"
      : "";
  answers.push({
    question: "Q12",
    label: "Relationship state",
    answer: `${relationshipDetail[relationship] ?? RELATIONSHIP_LABELS[relationship]}${agencyNote}`,
    known: true,
    source: crm,
    as_of: input.snapshot.fetchedAt,
    confidence: input.snapshot.contact ? "high" : "medium",
  });

  const reasonCodes: ReasonCode[] = [];
  const notes: string[] = [];
  let verdict: Verdict;
  const outcome: PrecheckOutcome = input.precheck.outcome;
  const signalName = input.precheck.signal ?? outcome;

  switch (outcome) {
    case "attach_to_owner":
      verdict = "attach_existing";
      reasonCodes.push({
        code: signalName,
        entry: outcomes.citation,
        detail: input.routing.reason,
      });
      reasonCodes.push({
        code: "already_accepted",
        entry: defSal.citation,
        detail:
          relationship === "owned"
            ? "The owning rep already accepted this lead (SAL)"
            : "The relationship is past SAL with an open deal or customer owner",
      });
      break;
    case "route_to_support":
      verdict = "route_elsewhere";
      reasonCodes.push({
        code: "support_request",
        entry: outcomes.citation,
        detail: "Support request",
      });
      reasonCodes.push({
        code: "not_a_sales_request",
        entry: defQl.citation,
        detail: "No sales request to qualify",
      });
      break;
    case "self_serve_thank_you":
    case "ignore_logged":
    case "disqualify_logged":
      verdict = "disqualify";
      reasonCodes.push({
        code: signalName,
        entry: outcomes.citation,
        detail: input.routing.reason,
      });
      reasonCodes.push({
        code: "not_a_sales_opportunity",
        entry: defDisqualify.citation,
        detail: "Closed with a reason logged for the weekly spot check",
      });
      break;
    default:
      if (input.assessment.intent === "sales") {
        verdict = "ql";
        reasonCodes.push({
          code: "sales_request_passed_precheck",
          entry: defQl.citation,
          detail: input.assessment.explicit_question
            ? "A legitimate sales request with an explicit question"
            : "A legitimate sales request",
        });
        if (agencyUnnamed) {
          reasonCodes.push({
            code: "enterprise_fit_unknown_until_client_named",
            entry: bar.citation,
            detail: "Size the buying entity; the client is not named yet",
          });
        }
      } else {
        verdict = "recycle";
        reasonCodes.push({
          code: "no_sales_request",
          entry: defRecycle.citation,
          detail: `Assessment intent is ${input.assessment.intent}; not ready for sales now`,
        });
        reasonCodes.push({
          code: "not_ql",
          entry: defQl.citation,
          detail:
            "Does not meet the QL definition: no legitimate sales request",
        });
      }
  }

  if (input.untrustedFlagged) {
    notes.push(
      "Message flagged for review: it contains instruction-like text. No instructions in it were followed.",
    );
  }

  return {
    verdict,
    suggested: true,
    reasonCodes,
    answers,
    hypothesis,
    notes,
    citations: uniqueCitations([
      ...reasonCodes.map((reason) => reason.entry),
      bar.citation,
    ]),
  };
}
