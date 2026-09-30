import { z } from "zod";

import recordedJson from "../../../fixtures/assessments.recorded.json";
import devProfilesJson from "../../../fixtures/dev-profiles.json";
import draftsJson from "../../../fixtures/drafts.recorded.json";
import casesJson from "../../../fixtures/inbound-cases.json";
import {
  FixtureCrmAdapter,
  fixtureFileSchema,
  type FixtureCase,
} from "../crm/fixture-adapter.js";
import { runPipeline } from "../pipeline/runner.js";
import type {
  Assessor,
  Drafter,
  PipelineDeps,
  PipelineRunResult,
} from "../pipeline/types.js";
import type { PlaybookRelease } from "../playbook/schema.js";
import type { PaRepository, UserProfileRecord } from "../repo/types.js";

export const SYNTHETIC_SOURCE = "synthetic";

const devProfilesSchema = z.object({
  note: z.string(),
  local_dev_user: z.string(),
  profiles: z.array(
    z.object({
      email: z.string(),
      display_name: z.string(),
      timezone: z.string(),
      working_hours: z.object({
        days: z.array(z.number().int().min(1).max(7)),
        start: z.string(),
        end: z.string(),
      }),
      roles: z.array(z.string()),
      in_round_robin: z.boolean(),
      link_local_dev_user: z.boolean().optional(),
    }),
  ),
  dev_pool: z.array(z.string()),
});

const recordedSchema = z.object({
  note: z.string(),
  assessments: z.record(z.string(), z.unknown()),
});

export const syntheticCases: FixtureCase[] =
  fixtureFileSchema.parse(casesJson).cases;
export const devProfiles = devProfilesSchema.parse(devProfilesJson);
const recorded = recordedSchema.parse(recordedJson).assessments;
const recordedDrafts = z
  .object({ note: z.string(), drafts: z.record(z.string(), z.unknown()) })
  .parse(draftsJson).drafts;

/** Fills the owner's first name into a recorded draft, as the agent would sign it. */
export function signDraft(raw: unknown, ownerFirstName: string | null) {
  if (!raw || typeof raw !== "object") return raw;
  const draft = raw as Record<string, unknown>;
  return typeof draft.body === "string"
    ? {
        ...draft,
        body: draft.body
          .split("{owner_first_name}")
          .join(ownerFirstName ?? "[owner first name]"),
      }
    : draft;
}

export function recordedDrafter(): Drafter {
  return {
    source: "recorded_fixture",
    async draft({ inbox, ownerFirstName }) {
      if (inbox.source !== SYNTHETIC_SOURCE) return null;
      const raw = recordedDrafts[inbox.externalId];
      return raw ? signDraft(raw, ownerFirstName) : null;
    },
  };
}

export function recordedAssessor(): Assessor {
  return {
    source: "recorded_fixture",
    async assess({ inbox }) {
      if (inbox.source !== SYNTHETIC_SOURCE) return null;
      return recorded[inbox.externalId] ?? null;
    },
  };
}

export async function registerRelease(
  repo: PaRepository,
  release: PlaybookRelease,
  label: "shadow" | "canary" | "production",
  now: Date,
): Promise<boolean> {
  return repo.insertReleaseIfAbsent({
    id: release.id,
    shortId: release.short_id,
    entries: release.entries,
    content: JSON.parse(JSON.stringify(release)) as Record<string, unknown>,
    label,
    createdAt: now.toISOString(),
  });
}

export async function seedSyntheticProfiles(
  repo: PaRepository,
  options: { linkUserId: string | null; now: Date; newId: () => string },
): Promise<UserProfileRecord[]> {
  const existing = await repo.listProfiles();
  const linkTaken = options.linkUserId
    ? existing.some((profile) => profile.userId === options.linkUserId)
    : true;
  const seeded: UserProfileRecord[] = [];
  for (const profile of devProfiles.profiles) {
    const current = existing.find((item) => item.email === profile.email);
    const link =
      profile.link_local_dev_user && !linkTaken ? options.linkUserId : null;
    const now = options.now.toISOString();
    seeded.push(
      await repo.upsertProfile({
        id: current?.id ?? options.newId(),
        userId: current?.userId ?? link,
        email: profile.email,
        displayName: profile.display_name,
        slackUserId: null,
        crmOwnerId: `owner:${profile.email}`,
        timezone: profile.timezone,
        workingHours: profile.working_hours,
        roles: profile.roles,
        inRoundRobin: profile.in_round_robin,
        isDesignPartner: false,
        isSynthetic: true,
        version: current?.version ?? 1,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      }),
    );
  }
  return seeded;
}

export interface ReplayCaseResult {
  caseId: string;
  engagementId: string | null;
  pipeline: PipelineRunResult["status"];
  error: string | null;
  actual: {
    precheck: string | null;
    route: string | null;
    verdict: string | null;
    state: string | null;
  };
  expected: { precheck: string; route: string; verdict: string };
  matches: { precheck: boolean; route: boolean; verdict: boolean };
  flaggedForReview: boolean;
}

export async function readOutcome(
  repo: PaRepository,
  engagementId: string | null,
) {
  if (!engagementId)
    return {
      precheck: null,
      route: null,
      verdict: null,
      state: null,
      flagged: false,
    };
  const engagement = await repo.getEngagement(engagementId);
  const receipts = await repo.listReceipts(engagementId);
  const precheck = [...receipts]
    .reverse()
    .find((receipt) => receipt.kind === "precheck");
  const route = [...receipts]
    .reverse()
    .find((receipt) => receipt.kind === "route");
  const scorecards = await repo.listScorecards(engagementId);
  const routing = route?.ruleResults.routing as { route?: string } | undefined;
  return {
    precheck: (precheck?.ruleResults.outcome as string | undefined) ?? null,
    route: routing?.route ?? null,
    verdict: scorecards[scorecards.length - 1]?.verdict ?? null,
    state: engagement?.state ?? null,
    flagged: (engagement?.reviewFlags.length ?? 0) > 0,
  };
}

export async function replaySyntheticCases(input: {
  repo: PaRepository;
  release: PlaybookRelease;
  now: () => Date;
  newId: () => string;
  caseId?: string;
  linkUserId: string | null;
}): Promise<ReplayCaseResult[]> {
  const cases = input.caseId
    ? syntheticCases.filter((item) => item.id === input.caseId)
    : syntheticCases;
  if (cases.length === 0) throw new Error(`No synthetic case ${input.caseId}`);

  await registerRelease(input.repo, input.release, "shadow", input.now());
  await seedSyntheticProfiles(input.repo, {
    linkUserId: input.linkUserId,
    now: input.now(),
    newId: input.newId,
  });

  const deps: PipelineDeps = {
    repo: input.repo,
    crm: new FixtureCrmAdapter(syntheticCases, input.now),
    release: input.release,
    assessor: recordedAssessor(),
    drafter: recordedDrafter(),
    now: input.now,
    newId: input.newId,
    devPool: devProfiles.dev_pool,
    mode: "shadow",
  };

  const results: ReplayCaseResult[] = [];
  for (const item of cases) {
    const receivedAt = input.now().toISOString();
    const { record } = await input.repo.insertInboxIfAbsent({
      id: input.newId(),
      source: SYNTHETIC_SOURCE,
      externalId: item.id,
      receivedAt,
      signatureOk: true,
      payload: {
        ...item.submission,
        form_id: "synthetic-contact-sales",
        submitted_at: receivedAt,
      },
      status: "pending",
      attempts: 0,
      lastError: null,
      nextAttemptAt: null,
      version: 1,
      createdAt: receivedAt,
      updatedAt: receivedAt,
    });
    const run = await runPipeline(record.id, deps);
    const outcome = await readOutcome(input.repo, run.engagementId);
    const expected = {
      precheck: item.expected.precheck ?? "",
      route: item.expected.route ?? "",
      verdict: item.expected.verdict ?? "",
    };
    results.push({
      caseId: item.id,
      engagementId: run.engagementId,
      pipeline: run.status,
      error: run.error ?? null,
      actual: {
        precheck: outcome.precheck,
        route: outcome.route,
        verdict: outcome.verdict,
        state: outcome.state,
      },
      expected,
      matches: {
        precheck: outcome.precheck === expected.precheck,
        route: outcome.route === expected.route,
        verdict: outcome.verdict === expected.verdict,
      },
      flaggedForReview: outcome.flagged,
    });
  }
  return results;
}
