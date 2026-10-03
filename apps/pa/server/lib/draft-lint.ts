// The message checks for one lead's draft, shared by the agent's save-draft
// and a person's edit-draft (D100): same playbook, route, and owner.
import {
  firstName,
  lintDraft,
  triggerSource,
  type DraftInput,
  type LintResult,
} from "../core/drafting/index.js";
import { routeForEngagement } from "../core/lead-route/engagement.js";
import { draftRouteOf } from "../core/lead-route/index.js";
import type { EngagementRecord, PaRepository } from "../core/repo/types.js";
import { activeRelease } from "./pa-context.js";

/**
 * Checks that compare the email with the agent's own rubric. A person's
 * edit is theirs to word, so these do not apply to it; every other rule does.
 */
const RUBRIC_CHECKS = new Set(["trigger", "connection"]);

export async function lintForEngagement(
  repository: PaRepository,
  engagement: EngagementRecord,
  draft: DraftInput,
  opts: { human?: boolean } = {},
): Promise<LintResult> {
  const submissions = await repository.listSubmissionsForEngagement(
    engagement.id,
  );
  const submission = submissions[submissions.length - 1];
  const assessment = submission
    ? await repository.getAssessmentForSubmission(submission.id)
    : null;
  const owner = engagement.ownerUserId
    ? await repository.getProfile(engagement.ownerUserId)
    : null;
  const routeReceipt = submission
    ? await repository.findReceipt("route", submission.id)
    : null;
  const routedOwner = (
    routeReceipt?.ruleResults.routing as
      | { owner?: { displayName?: string | null } | null }
      | undefined
  )?.owner;
  // Messaging follows the current playbook (D65).
  const messaging = await activeRelease(repository);
  const route = draftRouteOf(
    await routeForEngagement(repository, messaging, engagement),
  );
  const lint = lintDraft({
    route,
    draft,
    release: messaging,
    explicitQuestion: assessment?.explicitQuestion ?? null,
    ownerFirstName: firstName(
      owner?.displayName ?? routedOwner?.displayName ?? null,
    ),
    sourceText: submission ? triggerSource(submission) : null,
    askedText: submission?.message ?? null,
  });
  if (!opts.human) return lint;
  const problems = lint.problems.filter(
    (problem) => !RUBRIC_CHECKS.has(problem.code),
  );
  return { ...lint, ok: problems.length === 0, problems };
}
