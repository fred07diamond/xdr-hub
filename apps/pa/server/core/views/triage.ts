// The one-glance summary a PA reads first (D49): how the lead was classified,
// why, and the drafted reply. Pure, so the board, the record, the browser demo,
// and the tests all say the same thing.
import type {
  CitationView,
  DecisionView,
  DraftSummary,
  DraftView,
  TriageView,
} from "../../../shared/pa-views.js";
import { CHOICE_LABELS, type Choice } from "../decisions/index.js";
import {
  APPROACH_LABELS,
  CALENDAR_LINK_TOKEN,
  draftPlan,
  type Approach,
  type LintResult,
} from "../drafting/index.js";
import { VERDICT_LABELS, type Verdict } from "../objects/index.js";
import type {
  DecisionRecord,
  DraftRecord,
  EngagementRecord,
} from "../repo/types.js";

const SIGNAL_LABELS: Record<string, string> = {
  support_request: "Support request",
  educational: "Student or research",
  selling_to_us: "Vendor pitch",
  junk_or_fake: "Spam or test",
  restricted_country: "Restricted country",
  existing_deal_or_customer: "Customer or open deal",
  owned_account: "Already owned",
  active_conversation: "Active conversation",
};

const CTA_LABELS: Record<string, string> = {
  meeting: "Book a meeting",
  reply: "Reply to the email",
  trial: "Start a trial",
};

/** The lint rules in SPEC 5.5 that code checks, for "passes N checks". */
const LINT_CHECKS = 8;

const sentence = (text: string) => {
  const clean = text.trim().replace(/\.$/, "");
  return clean ? `${clean}.` : "";
};

export function triageFor(input: {
  engagement: EngagementRecord;
  precheckOutcome: string | null;
  signal: string | null;
  verdict: string | null;
  routeReason: string | null;
  ownerName: string | null;
  ownerIsMe: boolean;
  draftStatus: DraftSummary["status"];
  /** A live lead whose message the agent has not read yet. */
  awaitingAgent?: boolean;
  hasOpenDeal?: boolean;
  intent?: string | null;
}): TriageView {
  const verdictLabel = input.verdict
    ? (VERDICT_LABELS[input.verdict as Verdict] ?? input.verdict)
    : null;
  const owner = input.ownerName;
  const reason = input.routeReason ? sentence(input.routeReason) : "";

  if (!input.precheckOutcome && input.awaitingAgent) {
    return {
      kind: "pending",
      label: "Waiting for the agent",
      verdictLabel,
      why: "The agent reads the message first. Then PA classifies the lead and drafts the reply.",
      action: "Nothing to do yet. The draft follows on its own.",
    };
  }
  if (!input.precheckOutcome) {
    return {
      kind: "pending",
      label: "Still being triaged",
      verdictLabel,
      why: "The pipeline has not finished the pre-check for this lead.",
      action: "Nothing to do yet.",
    };
  }

  switch (input.precheckOutcome) {
    case "attach_to_owner":
      // Every lead has an owner (D59), so ownership is routing, not a class.
      if (input.signal === "existing_deal_or_customer" && input.hasOpenDeal)
        return {
          kind: "elsewhere",
          label: "Open deal",
          verdictLabel,
          why: `An open deal is in progress, so it goes to the deal owner${owner ? `, ${owner}` : ""}. Not a PA play.`,
          action: "The AE follows up.",
        };
      if (input.signal === "existing_deal_or_customer")
        return {
          kind: "review",
          label: "Existing customer",
          verdictLabel,
          why: `Routed to ${owner ?? "the account owner"}. PA cannot tell whether they are on the team already using Builder or a different team.`,
          action:
            "Check their team: redirect to the AE and CSM, or treat it as an expansion lead.",
        };
      return {
        kind: "reply",
        label:
          input.intent === "sales" || !input.intent
            ? "Qualified lead"
            : "Needs a look",
        verdictLabel: null,
        why: `Owned account, routed to ${owner ?? "the account owner"}.`,
        action: input.ownerIsMe
          ? "Yours: review the draft and decide."
          : `${owner ?? "The owner"} reviews the draft and decides.`,
      };
    case "route_to_support":
      return {
        kind: "elsewhere",
        label: "Support request",
        verdictLabel,
        why: "They need product help, not sales, so it goes to support.",
        action: "Nothing for sales to do.",
      };
    case "self_serve_thank_you":
      return {
        kind: "closed",
        label: SIGNAL_LABELS[input.signal ?? ""] ?? "Not a sales lead",
        verdictLabel,
        why: "Not a buying request. It gets the self-serve thank-you.",
        action:
          "No sales reply. The thank-you goes out once sending ships (M2).",
      };
    case "ignore_logged":
      return {
        kind: "closed",
        label: SIGNAL_LABELS[input.signal ?? ""] ?? "Not a lead",
        verdictLabel,
        why:
          input.signal === "selling_to_us"
            ? "They are selling to us, not buying."
            : "The submission looks like a test or spam.",
        action: "No reply. Logged for the weekly spot check.",
      };
    case "disqualify_logged":
      return {
        kind: "closed",
        label: SIGNAL_LABELS[input.signal ?? ""] ?? "Disqualified",
        verdictLabel,
        why:
          input.signal === "restricted_country"
            ? "We do not do business in their country."
            : "The pre-check disqualified this lead.",
        action: "No reply. Logged for the weekly spot check.",
      };
  }

  const flagged = input.engagement.reviewFlags.length > 0;
  const label =
    input.verdict === "ql"
      ? "Qualified lead"
      : input.verdict === "recycle"
        ? "Not sales ready"
        : (verdictLabel ?? "Needs a first touch");
  const assigned = owner
    ? reason
      ? `${reason.replace(/\.$/, "")} to ${owner}.`
      : `Assigned to ${owner}.`
    : reason || "Not assigned to an owner yet.";
  const draftAction: Record<DraftSummary["status"], string> = {
    ready: "Review the draft reply.",
    needs_edit: "The draft breaks a message rule: fix it before it goes out.",
    waiting: "The draft reply has not been written yet.",
    not_needed: "No reply to draft.",
  };
  if (flagged) {
    return {
      kind: "review",
      label: "Check before replying",
      verdictLabel,
      why: `The message contains instructions aimed at our tools, and none of them were followed. ${assigned}`,
      action: `Read the message first. ${draftAction[input.draftStatus]}`,
    };
  }
  return {
    kind: "reply",
    label,
    verdictLabel,
    why: assigned,
    action: draftAction[input.draftStatus],
  };
}

function preview(body: string, max = 160) {
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  // Skip the greeting line so the preview starts with the substance.
  const start = lines.length > 1 && /,$/.test(lines[0]) ? 1 : 0;
  const text = lines.slice(start).join(" ");
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}...` : text;
}

export function draftView(input: {
  engagement: EngagementRecord;
  precheckOutcome: string | null;
  signal?: string | null;
  draft: DraftRecord | null;
  lead: { name: string | null; email: string };
  ownerName: string | null;
  cite: (citation: { id: string; version: number }) => CitationView;
  entryVersion: (id: string) => number | null;
}): DraftView {
  const empty = {
    id: null,
    body: null,
    cta: null,
    approach: null,
    warnings: [],
    language: null,
    to: input.lead,
    from: input.ownerName,
    problems: [],
    notChecked: [],
    checksRun: 0,
    wordCount: null,
    usedEntries: [],
    source: null,
    createdAt: null,
    subject: null,
    preview: null,
    problemCount: 0,
  };
  const draft = input.draft;
  if (!draft && !input.precheckOutcome) {
    return {
      ...empty,
      status: "waiting",
      note: "The draft comes after the agent has read the message and PA has classified the lead.",
    };
  }
  if (!draft) {
    const plan = draftPlan({
      state: input.engagement.state,
      precheck: input.precheckOutcome,
      signal: input.signal ?? null,
      hasOwner: Boolean(input.engagement.ownerUserId),
    });
    return plan.needed
      ? {
          ...empty,
          status: "waiting",
          note: "The drafting step has not written this reply yet. Ask the agent to draft it now; nothing is sent.",
        }
      : { ...empty, status: "not_needed", note: plan.reason };
  }
  const lint = (draft.lint ?? null) as LintResult | null;
  const problems = lint?.problems ?? [];
  const status = draft.status === "needs_edit" ? "needs_edit" : "ready";
  return {
    ...empty,
    id: draft.id,
    status,
    subject: draft.subject,
    preview: preview(draft.body),
    body: draft.body,
    cta: { code: draft.cta, label: CTA_LABELS[draft.cta] ?? draft.cta },
    approach: lint?.approach
      ? {
          code: lint.approach,
          label: APPROACH_LABELS[lint.approach as Approach] ?? lint.approach,
        }
      : null,
    warnings: lint?.warnings ?? [],
    language: draft.language,
    problems,
    problemCount: problems.length,
    notChecked: lint?.notChecked ?? [],
    checksRun: LINT_CHECKS,
    wordCount: lint?.wordCount ?? null,
    usedEntries: draft.usedEntryIds
      .map((id) => {
        const version = input.entryVersion(id);
        return version === null ? null : input.cite({ id, version });
      })
      .filter((item): item is CitationView => item !== null),
    source: draft.source,
    createdAt: draft.createdAt,
    note:
      status === "ready"
        ? `Passes the message rules. Proposed only: nothing is sent.`
        : `${problems.length} message ${problems.length === 1 ? "rule" : "rules"} broken. Fix before it goes out.`,
  };
}

export function draftSummary(view: DraftView): DraftSummary {
  return {
    status: view.status,
    subject: view.subject,
    preview: view.preview,
    problemCount: view.problemCount,
    note: view.note,
  };
}

export { CALENDAR_LINK_TOKEN };

const choice = (code: string) => ({
  code,
  label: CHOICE_LABELS[code as Choice] ?? code,
});

export function decisionView(
  record: DecisionRecord | null,
  now: Date,
): DecisionView | null {
  if (!record) return null;
  return {
    status: record.status,
    kind: record.kind,
    options: record.options.map(choice),
    recommendation: choice(record.recommendation),
    reason: record.recommendationReason,
    question: record.question,
    dueAt: record.dueAt,
    overdue:
      record.status === "open" && Date.parse(record.dueAt) <= now.getTime(),
    slaMissedAt: record.slaMissedAt,
    choice: record.choice ? choice(record.choice) : null,
    note: record.note,
    decidedBy: record.decidedBy,
    decidedAt: record.decidedAt,
  };
}
