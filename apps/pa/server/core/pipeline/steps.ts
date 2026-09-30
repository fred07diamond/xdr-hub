import { z } from "zod";

import type { AssessmentInput } from "../assessment/index.js";
import { validateAssessment } from "../assessment/index.js";
import { planClocks, type WorkingHours } from "../clocks/index.js";
import { takeCrmSnapshot, type CrmSnapshot } from "../crm/port.js";
import {
  draftInputSchema,
  draftPlan,
  firstName,
  lintDraft,
} from "../drafting/index.js";
import { resolveIdentity, type ResolvedIdentity } from "../identity/index.js";
import {
  assertTransition,
  ENGAGEMENT_OUTCOMES,
  OPEN_STATES,
  type EngagementState,
} from "../objects/index.js";
import { rule, uniqueCitations } from "../playbook/resolve.js";
import type { Citation } from "../playbook/schema.js";
import { runPrecheck, type PrecheckResult } from "../precheck/index.js";
import type {
  EngagementRecord,
  EventRecord,
  PaRepository,
  ReceiptRecord,
  UserProfileRecord,
} from "../repo/types.js";
import {
  routeEngagement,
  type RoutingProfile,
  type RoutingResult,
} from "../routing/index.js";
import { scoreEngagement, type ScorecardResult } from "../scorecard/index.js";
import { scanUntrusted, type UntrustedScan } from "../untrusted/index.js";
import type {
  PipelineDeps,
  PipelineState,
  StepName,
  StepOutcome,
} from "./types.js";

export interface PipelineStep {
  name: StepName;
  isDone(deps: PipelineDeps, state: PipelineState): Promise<boolean>;
  hydrate(deps: PipelineDeps, state: PipelineState): Promise<void>;
  run(deps: PipelineDeps, state: PipelineState): Promise<StepOutcome>;
}

const submissionPayloadSchema = z.object({
  email: z.string().min(3),
  name: z.string().optional(),
  company: z.string().optional(),
  country: z.string().optional(),
  message: z.string().optional(),
  form_id: z.string().optional(),
  page_url: z.string().optional(),
  submitted_at: z.string().optional(),
  /** Other form answers (use case, tech stack, budget, company size). Data, never instructions. */
  fields: z.record(z.string(), z.string().nullable()).optional(),
  crm_contact_id: z.string().optional(),
});

function need<T>(value: T | null | undefined, what: string): T {
  if (value === undefined || value === null)
    throw new Error(`Pipeline state is missing ${what}`);
  return value;
}

function iso(deps: PipelineDeps) {
  return deps.now().toISOString();
}

function newEvent(
  deps: PipelineDeps,
  state: PipelineState,
  type: string,
  payload: Record<string, unknown>,
  receiptId: string | null,
  actor = "system",
): EventRecord {
  return {
    id: deps.newId(),
    engagementId: state.engagement?.id ?? null,
    correlationId: state.inbox.id,
    type,
    actor,
    payload,
    receiptId,
    occurredAt: iso(deps),
  };
}

function newReceipt(
  deps: PipelineDeps,
  state: PipelineState,
  kind: StepName,
  body: {
    entryVersions?: Citation[];
    ruleResults: Record<string, unknown>;
    inputs: Record<string, unknown>;
  },
): ReceiptRecord {
  return {
    id: deps.newId(),
    kind,
    engagementId: state.engagement?.id ?? null,
    submissionId: state.submission?.id ?? null,
    playbookReleaseId: deps.release.id,
    entryVersions: body.entryVersions ?? [],
    ruleResults: body.ruleResults,
    inputs: body.inputs,
    agentRunId: null,
    toolCalls: null,
    model: null,
    createdAt: iso(deps),
  };
}

function toJson<T>(value: T): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

async function receiptDone(
  deps: PipelineDeps,
  state: PipelineState,
  kind: StepName,
) {
  if (!state.submission) return false;
  return Boolean(await deps.repo.findReceipt(kind, state.submission.id));
}

async function moveState(
  repo: PaRepository,
  deps: PipelineDeps,
  state: PipelineState,
  to: EngagementState,
  patch: Partial<EngagementRecord>,
  receiptId: string,
) {
  const engagement = need(state.engagement, "engagement");
  const from = engagement.state as EngagementState;
  assertTransition(from, to);
  state.engagement = await repo.updateEngagement(
    engagement.id,
    { ...patch, state: to, updatedAt: iso(deps) },
    engagement.version,
  );
  await repo.appendEvent(
    newEvent(deps, state, "state.changed", { from, to }, receiptId),
  );
}

export function assessmentInput(record: {
  intent: string;
  agencySignal: boolean;
  evidenceQuotes: string[];
  endClientNamed: boolean;
  productInterest: string;
  language: string;
  explicitQuestion: string | null;
}): AssessmentInput {
  return {
    intent: record.intent as AssessmentInput["intent"],
    agency_signal: record.agencySignal,
    evidence_quotes: record.evidenceQuotes,
    end_client_named: record.endClientNamed,
    product_interest:
      record.productInterest as AssessmentInput["product_interest"],
    language: record.language,
    explicit_question: record.explicitQuestion,
  };
}

export function toRoutingProfile(profile: UserProfileRecord): RoutingProfile {
  return {
    id: profile.id,
    email: profile.email,
    displayName: profile.displayName,
    workingHours: profileHours(profile),
    inRoundRobin: profile.inRoundRobin,
  };
}

export function profileHours(profile: UserProfileRecord): WorkingHours {
  return {
    timezone: profile.timezone,
    days: profile.workingHours.days,
    start: profile.workingHours.start,
    end: profile.workingHours.end,
  };
}

const normalize: PipelineStep = {
  name: "normalize",
  async isDone(deps, state) {
    const submission = await deps.repo.getSubmissionByInbox(state.inbox.id);
    if (!submission) return false;
    state.submission = submission;
    return receiptDone(deps, state, "normalize");
  },
  async hydrate(deps, state) {
    const submission = need(state.submission, "submission");
    const receipt = await deps.repo.findReceipt("normalize", submission.id);
    const results = need(receipt, "normalize receipt").ruleResults;
    state.identity = results.identity as ResolvedIdentity;
    state.untrusted = results.untrusted as UntrustedScan;
    state.attachedToOpen = results.engagement_action === "attached_to_open";
    state.engagement = need(
      (await deps.repo.getEngagement(
        need(submission.engagementId ?? undefined, "engagement id"),
      )) ?? undefined,
      "engagement",
    );
    state.account = state.engagement.accountId
      ? await deps.repo.getAccount(state.engagement.accountId)
      : null;
  },
  async run(deps, state) {
    const repo = deps.repo;
    const payload = submissionPayloadSchema.safeParse(state.inbox.payload);
    if (!payload.success) {
      return {
        status: "fail",
        reason: `Submission payload is invalid: ${payload.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
      };
    }
    let identity: ResolvedIdentity;
    try {
      identity = resolveIdentity({
        email: payload.data.email,
        name: payload.data.name,
        company: payload.data.company,
      });
    } catch (error) {
      return { status: "fail", reason: (error as Error).message };
    }
    const now = iso(deps);
    const message = payload.data.message ?? null;
    // Name and company are stranger-written too, so they are scanned as well.
    const untrusted = [message, identity.name, identity.companyName]
      .map((text) => scanUntrusted(text, { submitterEmail: identity.email }))
      .reduce((all, scan) => ({
        flagged: all.flagged || scan.flagged,
        matches: [...all.matches, ...scan.matches],
      }));

    let account = identity.accountDomain
      ? await repo.getAccountByDomain(identity.accountDomain)
      : null;
    if (identity.accountDomain && !account) {
      account = {
        id: deps.newId(),
        domain: identity.accountDomain,
        name: identity.companyName,
        crmCompanyRef: null,
        flags: {},
        firmographics: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await repo.insertAccount(account);
    }
    let contact = await repo.getContactByEmail(identity.email);
    if (!contact) {
      contact = {
        id: deps.newId(),
        email: identity.email,
        name: identity.name,
        title: null,
        accountId: account?.id ?? null,
        crmContactRef: null,
        language: null,
        optOut: false,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await repo.insertContact(contact);
    }

    // The newest open engagement wins, so attachment is deterministic. Two
    // concurrent first submissions cannot both create one: the second hits
    // pa_engagements_open_contact_idx, retries, and attaches here (FR-2).
    const open = (await repo.listEngagementsForContact(contact.id))
      .filter((item) => OPEN_STATES.has(item.state as EngagementState))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const submissionId = deps.newId();
    let engagement: EngagementRecord;
    if (open) {
      engagement = open;
      state.attachedToOpen = true;
    } else {
      engagement = {
        id: deps.newId(),
        accountId: account?.id ?? null,
        contactId: contact.id,
        motion: "contact_sale",
        state: "new",
        ownerUserId: null,
        ownerSource: null,
        routeReason: null,
        relationshipState: null,
        firstTouchDueAt: null,
        decisionDueAt: null,
        firstTouchAt: null,
        outcome: null,
        attachedToId: null,
        playbookReleaseId: deps.release.id,
        mode: deps.mode,
        reviewFlags: [],
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await repo.insertEngagement(engagement);
      state.attachedToOpen = false;
    }

    const submittedAt = payload.data.submitted_at ?? state.inbox.receivedAt;
    const flags = untrusted.matches.map((match) => ({
      pattern: match.pattern,
      text: match.text,
    }));
    state.submission = {
      id: submissionId,
      inboxId: state.inbox.id,
      engagementId: engagement.id,
      formId: payload.data.form_id ?? null,
      submittedAt,
      email: identity.email,
      name: identity.name,
      companyName: identity.companyName,
      message,
      fields: {
        ...Object.fromEntries(
          Object.entries(payload.data.fields ?? {}).filter(
            (entry): entry is [string, string] => Boolean(entry[1]),
          ),
        ),
        ...(payload.data.country ? { country: payload.data.country } : {}),
      },
      flags,
      crmContactRef: null,
      pageUrl: payload.data.page_url ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await repo.insertSubmission(state.submission);

    if (untrusted.flagged) {
      engagement = await repo.updateEngagement(
        engagement.id,
        {
          reviewFlags: [
            ...engagement.reviewFlags,
            {
              code: "untrusted_instructions",
              detail:
                "The form message contains instruction-like text. Nothing in it was followed.",
              submissionId,
              at: now,
            },
          ],
          updatedAt: now,
        },
        engagement.version,
      );
    }
    state.engagement = engagement;
    state.identity = identity;
    state.untrusted = untrusted;
    state.account = account;

    const receipt = newReceipt(deps, state, "normalize", {
      ruleResults: toJson({
        identity,
        untrusted,
        engagement_action: state.attachedToOpen
          ? "attached_to_open"
          : "created",
      }),
      inputs: {
        inbox_id: state.inbox.id,
        source: state.inbox.source,
        external_id: state.inbox.externalId,
      },
    });
    await repo.insertReceipt(receipt);
    await repo.appendEvent(
      newEvent(
        deps,
        state,
        "submission.received",
        { submission_id: submissionId, source: state.inbox.source },
        receipt.id,
      ),
    );
    await repo.appendEvent(
      newEvent(
        deps,
        state,
        state.attachedToOpen
          ? "submission.attached_to_open"
          : "engagement.created",
        {
          submission_id: submissionId,
          personal_domain: identity.personalDomain,
        },
        receipt.id,
      ),
    );
    if (untrusted.flagged) {
      await repo.appendEvent(
        newEvent(
          deps,
          state,
          "untrusted.flagged",
          {
            patterns: [
              ...new Set(untrusted.matches.map((match) => match.pattern)),
            ],
          },
          receipt.id,
        ),
      );
    }
    return { status: "done" };
  },
};

const crmSnapshot: PipelineStep = {
  name: "crm_snapshot",
  isDone: (deps, state) => receiptDone(deps, state, "crm_snapshot"),
  async hydrate(deps, state) {
    const receipt = need(
      (await deps.repo.findReceipt(
        "crm_snapshot",
        need(state.submission, "submission").id,
      )) ?? undefined,
      "crm_snapshot receipt",
    );
    state.snapshot = receipt.ruleResults.snapshot as CrmSnapshot;
    state.snapshotReceiptId = receipt.id;
  },
  async run(deps, state) {
    const identity = need(state.identity, "identity");
    const snapshot = await takeCrmSnapshot(
      deps.crm,
      identity.email,
      iso(deps),
      state.submission?.submittedAt,
    );
    state.snapshot = snapshot;
    const receipt = newReceipt(deps, state, "crm_snapshot", {
      ruleResults: toJson({ snapshot }),
      inputs: { crm_system: deps.crm.system, lookup: "contact_by_email" },
    });
    state.snapshotReceiptId = receipt.id;
    await deps.repo.insertReceipt(receipt);
    await deps.repo.appendEvent(
      newEvent(
        deps,
        state,
        "crm.snapshot_taken",
        {
          source: snapshot.source,
          fetched_at: snapshot.fetchedAt,
          found: Boolean(snapshot.contact),
          lifecycle: snapshot.contact?.lifecycleRaw ?? null,
          owner: snapshot.contact?.owner?.email ?? null,
          open_deals: snapshot.openDeals.length,
          customer: Boolean(snapshot.contact?.isCustomer),
        },
        receipt.id,
      ),
    );
    return { status: "done" };
  },
};

const assessMessage: PipelineStep = {
  name: "assess_message",
  isDone: (deps, state) => receiptDone(deps, state, "assess_message"),
  async hydrate(deps, state) {
    state.assessment = need(
      (await deps.repo.getAssessmentForSubmission(
        need(state.submission, "submission").id,
      )) ?? undefined,
      "assessment",
    );
  },
  async run(deps, state) {
    const submission = need(state.submission, "submission");
    const engagement = need(state.engagement, "engagement");
    const raw = await deps.assessor.assess({
      inbox: state.inbox,
      submission,
      engagementId: engagement.id,
    });
    if (raw === null) {
      if (deps.assessor.waitsForAgent) {
        await requestAgentWork(deps, state, "assess_message");
        return {
          status: "halt",
          reason: "Waiting for the agent's message assessment",
        };
      }
      return {
        status: "fail",
        reason: "No assessment available for this submission.",
      };
    }
    const validation = validateAssessment(raw, submission.message);
    if (!validation.ok) {
      return {
        status: "fail",
        reason: `Assessment rejected: ${validation.errors.join("; ")}`,
      };
    }
    const value = validation.value;
    const receipt = newReceipt(deps, state, "assess_message", {
      ruleResults: toJson({
        validation: "passed",
        source: deps.assessor.source,
      }),
      inputs: { submission_id: submission.id, message_quoted: true },
    });
    state.assessment = {
      id: deps.newId(),
      engagementId: engagement.id,
      submissionId: submission.id,
      intent: value.intent,
      agencySignal: value.agency_signal,
      evidenceQuotes: value.evidence_quotes,
      endClientNamed: value.end_client_named,
      productInterest: value.product_interest,
      language: value.language,
      explicitQuestion: value.explicit_question,
      source: deps.assessor.source,
      receiptId: receipt.id,
      createdAt: iso(deps),
    };
    await deps.repo.insertReceipt(receipt);
    await deps.repo.insertAssessment(state.assessment);
    await deps.repo.appendEvent(
      newEvent(
        deps,
        state,
        "message.assessed",
        {
          assessment_id: state.assessment.id,
          intent: value.intent,
          source: deps.assessor.source,
        },
        receipt.id,
        `agent:assess_message (${deps.assessor.source})`,
      ),
    );
    return { status: "done" };
  },
};

const precheck: PipelineStep = {
  name: "precheck",
  isDone: (deps, state) => receiptDone(deps, state, "precheck"),
  async hydrate(deps, state) {
    const receipt = need(
      (await deps.repo.findReceipt(
        "precheck",
        need(state.submission, "submission").id,
      )) ?? undefined,
      "precheck receipt",
    );
    state.precheck = receipt.ruleResults as unknown as PrecheckResult;
    state.precheckReceiptId = receipt.id;
    state.engagement =
      (await deps.repo.getEngagement(
        need(state.engagement, "engagement").id,
      )) ?? state.engagement;
  },
  async run(deps, state) {
    const submission = need(state.submission, "submission");
    const result = runPrecheck({
      release: deps.release,
      assessment: assessmentInput(need(state.assessment, "assessment")),
      snapshot: need(state.snapshot, "crm snapshot"),
      country:
        typeof submission.fields.country === "string"
          ? submission.fields.country
          : null,
      now: deps.now(),
    });
    state.precheck = result;
    const receipt = newReceipt(deps, state, "precheck", {
      entryVersions: result.citations,
      ruleResults: toJson(result),
      inputs: {
        assessment_id: state.assessment?.id,
        crm_snapshot_receipt_id: state.snapshotReceiptId,
      },
    });
    state.precheckReceiptId = receipt.id;
    await deps.repo.insertReceipt(receipt);
    await deps.repo.appendEvent(
      newEvent(
        deps,
        state,
        "precheck.completed",
        { outcome: result.outcome, signal: result.signal },
        receipt.id,
      ),
    );
    if (need(state.engagement, "engagement").state === "new") {
      await moveState(deps.repo, deps, state, "prechecked", {}, receipt.id);
    }
    return { status: "done" };
  },
};

const SETTLED_STATE: Record<
  string,
  { state: EngagementState; outcome: string | null; clockReason: string }
> = {
  attach_to_owner: { state: "attached", outcome: null, clockReason: "" },
  route_to_support: {
    state: "closed",
    outcome: ENGAGEMENT_OUTCOMES.route_to_support,
    clockReason: "No clock: routed to support",
  },
  self_serve_thank_you: {
    state: "disqualified",
    outcome: ENGAGEMENT_OUTCOMES.self_serve_thank_you,
    clockReason: "No clock: disqualified, self-serve thank-you",
  },
  ignore_logged: {
    state: "disqualified",
    outcome: ENGAGEMENT_OUTCOMES.ignore_logged,
    clockReason: "No clock: ignored and logged for the weekly spot check",
  },
  disqualify_logged: {
    state: "disqualified",
    outcome: ENGAGEMENT_OUTCOMES.disqualify_logged,
    clockReason: "No clock: disqualified and logged",
  },
};

const route: PipelineStep = {
  name: "route",
  isDone: (deps, state) => receiptDone(deps, state, "route"),
  async hydrate(deps, state) {
    const receipt = need(
      (await deps.repo.findReceipt(
        "route",
        need(state.submission, "submission").id,
      )) ?? undefined,
      "route receipt",
    );
    state.routing = receipt.ruleResults.routing as RoutingResult;
    state.routeReceiptId = receipt.id;
    state.engagement =
      (await deps.repo.getEngagement(
        need(state.engagement, "engagement").id,
      )) ?? state.engagement;
  },
  async run(deps, state) {
    const engagement = need(state.engagement, "engagement");
    const precheckResult = need(state.precheck, "precheck");
    const assessment = assessmentInput(need(state.assessment, "assessment"));
    const profiles = await deps.repo.listProfiles();
    const counts: Record<string, number> = {};
    for (const item of await deps.repo.listEngagements()) {
      if (item.ownerSource === "round_robin" && item.ownerUserId) {
        counts[item.ownerUserId] = (counts[item.ownerUserId] ?? 0) + 1;
      }
    }
    const result = routeEngagement({
      release: deps.release,
      precheck: precheckResult,
      assessment,
      snapshot: need(state.snapshot, "crm snapshot"),
      accountAgencyFlag: Boolean(state.account?.flags?.agency?.value),
      profiles: profiles.map(toRoutingProfile),
      assignmentCounts: counts,
      devPool: deps.devPool,
      now: deps.now(),
    });
    state.routing = result;

    if (engagement.state !== "prechecked") {
      const receipt = newReceipt(deps, state, "route", {
        entryVersions: result.citations,
        ruleResults: toJson({
          routing: result,
          applied: false,
          reason: "Engagement already routed; owner unchanged",
        }),
        inputs: { precheck_receipt_id: state.precheckReceiptId },
      });
      state.routeReceiptId = receipt.id;
      await deps.repo.insertReceipt(receipt);
      await deps.repo.appendEvent(
        newEvent(
          deps,
          state,
          "route.unchanged",
          { reason: "attached to an open engagement" },
          receipt.id,
        ),
      );
      return { status: "done" };
    }

    const firstTouch = rule(deps.release, "rule.sla.first_touch");
    const decision = rule(deps.release, "rule.sla.decision");
    const settled = SETTLED_STATE[precheckResult.outcome];
    const ownerProfile = result.owner?.profileId
      ? (profiles.find((profile) => profile.id === result.owner?.profileId) ??
        null)
      : null;
    const nextState: EngagementState = settled
      ? settled.state
      : ownerProfile
        ? "awaiting_first_touch"
        : "routed";
    const submission = need(state.submission, "submission");
    const clocks = planClocks({
      hasHumanOwner: Boolean(ownerProfile),
      ownerHours: ownerProfile ? profileHours(ownerProfile) : null,
      submittedAt: new Date(submission.submittedAt),
      state: nextState,
      relationshipState: result.relationshipState,
      firstTouchMinutes: firstTouch.params.minutes,
      decisionHours: decision.params.hours,
      settledReason:
        settled?.clockReason ||
        (ownerProfile
          ? undefined
          : result.owner
            ? `No SLA timer: ${result.owner.displayName ?? result.owner.email} has no PA profile yet`
            : "No clock: no human owner assigned yet"),
    });
    const citations = uniqueCitations([
      ...result.citations,
      firstTouch.citation,
      decision.citation,
    ]);
    const receipt = newReceipt(deps, state, "route", {
      entryVersions: citations,
      ruleResults: toJson({
        routing: result,
        applied: true,
        next_state: nextState,
        clocks,
      }),
      inputs: {
        precheck_receipt_id: state.precheckReceiptId,
        crm_snapshot_receipt_id: state.snapshotReceiptId,
      },
    });
    state.routeReceiptId = receipt.id;
    await deps.repo.insertReceipt(receipt);

    const patch: Partial<EngagementRecord> = {
      ownerUserId: ownerProfile?.id ?? null,
      ownerSource: result.ownerSource,
      routeReason: result.reason,
      relationshipState: result.relationshipState,
      firstTouchDueAt: clocks.firstTouch.dueAt,
      decisionDueAt: clocks.decision.dueAt,
      outcome: settled?.outcome ?? null,
    };
    await deps.repo.appendEvent(
      newEvent(
        deps,
        state,
        "engagement.routed",
        {
          route: result.route,
          owner: result.owner?.displayName ?? null,
          owner_source: result.ownerSource,
          relationship_state: result.relationshipState,
          reason: result.reason,
        },
        receipt.id,
      ),
    );
    if (nextState === "awaiting_first_touch") {
      await moveState(deps.repo, deps, state, "routed", patch, receipt.id);
      await moveState(
        deps.repo,
        deps,
        state,
        "awaiting_first_touch",
        {},
        receipt.id,
      );
    } else {
      await moveState(deps.repo, deps, state, nextState, patch, receipt.id);
    }
    await deps.repo.appendEvent(
      newEvent(
        deps,
        state,
        clocks.firstTouch.applies ? "clock.started" : "clock.not_applicable",
        clocks.firstTouch.applies
          ? {
              first_touch_due_at: clocks.firstTouch.dueAt,
              starts_at: clocks.firstTouch.startsAt,
              decision_due_at: clocks.decision.dueAt,
            }
          : { reason: clocks.firstTouch.reason },
        receipt.id,
      ),
    );
    return { status: "done" };
  },
};

const score: PipelineStep = {
  name: "score",
  isDone: (deps, state) => receiptDone(deps, state, "score"),
  async hydrate(deps, state) {
    const receipt = need(
      (await deps.repo.findReceipt(
        "score",
        need(state.submission, "submission").id,
      )) ?? undefined,
      "score receipt",
    );
    state.scorecard = receipt.ruleResults as unknown as ScorecardResult;
  },
  async run(deps, state) {
    const engagement = need(state.engagement, "engagement");
    const submission = need(state.submission, "submission");
    const assessmentRecord = need(state.assessment, "assessment");
    const result = scoreEngagement({
      release: deps.release,
      precheck: need(state.precheck, "precheck"),
      routing: need(state.routing, "routing"),
      assessment: assessmentInput(assessmentRecord),
      assessmentId: assessmentRecord.id,
      assessedAt: assessmentRecord.createdAt,
      snapshot: need(state.snapshot, "crm snapshot"),
      identity: need(state.identity, "identity"),
      submissionId: submission.id,
      submittedAt: submission.submittedAt,
      untrustedFlagged: Boolean(state.untrusted?.flagged),
    });
    state.scorecard = result;
    const previous = await deps.repo.listScorecards(engagement.id);
    const version = (previous[previous.length - 1]?.version ?? 0) + 1;
    const receipt = newReceipt(deps, state, "score", {
      entryVersions: result.citations,
      ruleResults: toJson(result),
      inputs: {
        assessment_id: assessmentRecord.id,
        precheck_receipt_id: state.precheckReceiptId,
        route_receipt_id: state.routeReceiptId,
        crm_snapshot_receipt_id: state.snapshotReceiptId,
      },
    });
    await deps.repo.insertReceipt(receipt);
    await deps.repo.insertScorecard({
      id: deps.newId(),
      engagementId: engagement.id,
      submissionId: submission.id,
      version,
      verdict: result.verdict,
      reasonCodes: toJson({ items: result.reasonCodes }).items as unknown[],
      answers: toJson({ items: result.answers }).items as unknown[],
      hypothesis: toJson(result.hypothesis),
      receiptId: receipt.id,
      createdAt: iso(deps),
    });
    await deps.repo.appendEvent(
      newEvent(
        deps,
        state,
        "scorecard.written",
        { verdict: result.verdict, version, suggested: true },
        receipt.id,
      ),
    );
    return { status: "done" };
  },
};

/** Records, once per submission, that the agent owes this step. */
async function requestAgentWork(
  deps: PipelineDeps,
  state: PipelineState,
  step: "assess_message" | "draft",
) {
  const existing = await deps.repo.listEventsByCorrelation(state.inbox.id);
  if (
    existing.some(
      (item) =>
        item.type === "agent.work_requested" && item.payload.step === step,
    )
  )
    return;
  await deps.repo.appendEvent(
    newEvent(deps, state, "agent.work_requested", { step }, null),
  );
}

function skipStep(name: "notify", reason: string): PipelineStep {
  return {
    name,
    async isDone() {
      return false;
    },
    async hydrate() {},
    async run(deps, state) {
      const existing = await deps.repo.listEventsByCorrelation(state.inbox.id);
      const already = existing.some(
        (item) => item.type === "step.skipped" && item.payload.step === name,
      );
      if (!already) {
        await deps.repo.appendEvent(
          newEvent(deps, state, "step.skipped", { step: name, reason }, null),
        );
      }
      return { status: "skip", reason };
    },
  };
}

// Step 7 (SPEC 5.3): a first-touch draft for a new, routed lead, linted before
// anyone sees it. Proposed only; nothing is sent (D7).
const draft: PipelineStep = {
  name: "draft",
  isDone: (deps, state) => receiptDone(deps, state, "draft"),
  async hydrate() {},
  async run(deps, state) {
    const engagement = need(state.engagement, "engagement");
    const submission = need(state.submission, "submission");
    const plan = draftPlan({
      state: engagement.state,
      precheck: state.precheck?.outcome ?? null,
      hasOwner: Boolean(engagement.ownerUserId),
    });
    const owner = engagement.ownerUserId
      ? await deps.repo.getProfile(engagement.ownerUserId)
      : null;
    // The HubSpot owner signs when they have no PA profile yet.
    const ownerFirstName = firstName(
      owner?.displayName ?? state.routing?.owner?.displayName ?? null,
    );
    if (!plan.needed) {
      const receipt = newReceipt(deps, state, "draft", {
        ruleResults: { needed: false, reason: plan.reason },
        inputs: { state: engagement.state },
      });
      await deps.repo.insertReceipt(receipt);
      return { status: "done" };
    }
    const raw = await deps.drafter.draft({
      inbox: state.inbox,
      engagement,
      submission,
      ownerFirstName,
    });
    if (raw === null) {
      // Not a failure: the lead waits for its draft. No receipt, so the
      // agent's save-draft is what completes it.
      if (deps.drafter.waitsForAgent)
        await requestAgentWork(deps, state, "draft");
      return { status: "skip", reason: "No draft available yet" };
    }
    const parsed = draftInputSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        status: "fail",
        reason: `Draft rejected: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`,
      };
    }
    const lint = lintDraft({
      draft: parsed.data,
      release: deps.release,
      explicitQuestion: state.assessment?.explicitQuestion ?? null,
      ownerFirstName,
    });
    const used = deps.release.entries
      .filter((entry) => parsed.data.used_entry_ids.includes(entry.id))
      .map((entry) => ({ id: entry.id, version: entry.version }));
    const receipt = newReceipt(deps, state, "draft", {
      entryVersions: used,
      ruleResults: toJson({ needed: true, source: deps.drafter.source, lint }),
      inputs: { submission_id: submission.id, owner: owner?.email ?? null },
    });
    const at = iso(deps);
    const draftId = deps.newId();
    await deps.repo.insertReceipt(receipt);
    await deps.repo.insertDraft({
      id: draftId,
      engagementId: engagement.id,
      submissionId: submission.id,
      subject: parsed.data.subject,
      body: parsed.data.body,
      cta: parsed.data.cta,
      language: parsed.data.language,
      status: lint.ok ? "proposed" : "needs_edit",
      usedEntryIds: parsed.data.used_entry_ids,
      lint: toJson(lint),
      source: deps.drafter.source,
      receiptId: receipt.id,
      version: 1,
      createdAt: at,
      updatedAt: at,
    });
    await deps.repo.appendEvent(
      newEvent(
        deps,
        state,
        "draft.proposed",
        {
          draft_id: draftId,
          lint_ok: lint.ok,
          problems: lint.problems.length,
          source: deps.drafter.source,
        },
        receipt.id,
        `agent:draft (${deps.drafter.source})`,
      ),
    );
    return { status: "done" };
  },
};

export const STEPS: PipelineStep[] = [
  normalize,
  crmSnapshot,
  assessMessage,
  precheck,
  route,
  score,
  draft,
  skipStep("notify", "M1"),
];
