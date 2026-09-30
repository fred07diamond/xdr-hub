import type { CrmPort, CrmSnapshot } from "../crm/port.js";
import type { ResolvedIdentity } from "../identity/index.js";
import type { PlaybookRelease } from "../playbook/schema.js";
import type { PrecheckResult } from "../precheck/index.js";
import type {
  AccountRecord,
  AssessmentRecord,
  EngagementRecord,
  InboxRecord,
  PaRepository,
  SubmissionRecord,
} from "../repo/types.js";
import type { RoutingResult } from "../routing/index.js";
import type { ScorecardResult } from "../scorecard/index.js";
import type { UntrustedScan } from "../untrusted/index.js";

export const PIPELINE_STEPS = [
  "normalize",
  "crm_snapshot",
  "assess_message",
  "precheck",
  "route",
  "score",
  "draft",
  "notify",
] as const;
export type StepName = (typeof PIPELINE_STEPS)[number];

export type StepStatus = "done" | "skip" | "retry" | "fail" | "halt";

export interface StepOutcome {
  status: StepStatus;
  reason?: string;
}

export interface StepResult extends StepOutcome {
  step: StepName;
  reused: boolean;
}

export interface Assessor {
  readonly source: string;
  /**
   * True for the live agent path: no assessment yet means "ask the agent and
   * wait", not a failure. The agent's save-message-assessment resumes the run.
   */
  readonly waitsForAgent?: boolean;
  assess(input: {
    inbox: InboxRecord;
    submission: SubmissionRecord;
    engagementId: string;
  }): Promise<unknown | null>;
}

/**
 * Writes the first-touch draft (SPEC 5.4). Replay and demo use recorded
 * fixtures; the live pipeline uses the drafting agent step (D3). Returning
 * null means no draft is available yet, which is not a failure: the lead waits
 * for one and the owner can ask the agent.
 */
export interface Drafter {
  readonly source: string;
  /** True for the live agent path: no draft yet means the agent is asked for one. */
  readonly waitsForAgent?: boolean;
  draft(input: {
    inbox: InboxRecord;
    engagement: EngagementRecord;
    submission: SubmissionRecord;
    ownerFirstName: string | null;
  }): Promise<unknown | null>;
}

export interface PipelineDeps {
  repo: PaRepository;
  crm: CrmPort;
  release: PlaybookRelease;
  assessor: Assessor;
  drafter: Drafter;
  now: () => Date;
  newId: () => string;
  /**
   * Synthetic round-robin pool, used only when the release pool is empty.
   * Demo and synthetic replay pass the dev pool; the live pipeline (M1 intake)
   * must pass [] so a real lead is never assigned to a synthetic profile.
   */
  devPool: string[];
  mode: "shadow";
}

export interface PipelineState {
  inbox: InboxRecord;
  submission?: SubmissionRecord;
  engagement?: EngagementRecord;
  identity?: ResolvedIdentity;
  untrusted?: UntrustedScan;
  account?: AccountRecord | null;
  snapshot?: CrmSnapshot;
  snapshotReceiptId?: string;
  assessment?: AssessmentRecord;
  precheck?: PrecheckResult;
  precheckReceiptId?: string;
  routing?: RoutingResult;
  routeReceiptId?: string;
  scorecard?: ScorecardResult;
  attachedToOpen?: boolean;
}

export interface PipelineRunResult {
  inboxId: string;
  status: "done" | "failed" | "pending";
  engagementId: string | null;
  steps: StepResult[];
  error?: string;
}

/** A step failure worth retrying (the default for unclassified errors). */
export class TransientStepError extends Error {}
/** A step failure that retrying cannot fix: bad input or an illegal transition. */
export class PermanentStepError extends Error {}
