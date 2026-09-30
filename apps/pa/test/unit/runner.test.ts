import { beforeEach, describe, expect, it } from "vitest";

import { FixtureCrmAdapter } from "../../server/core/crm/fixture-adapter.js";
import {
  CLAIM_LEASE_MS,
  MAX_ATTEMPTS,
  runPipeline,
} from "../../server/core/pipeline/runner.js";
import { STEPS, type PipelineStep } from "../../server/core/pipeline/steps.js";
import {
  TransientStepError,
  type PipelineDeps,
} from "../../server/core/pipeline/types.js";
import { seedRelease } from "../../server/core/playbook/release.js";
import {
  devProfiles,
  recordedAssessor,
  recordedDrafter,
  seedSyntheticProfiles,
  syntheticCases,
} from "../../server/core/replay/index.js";
import { MemoryRepository } from "../../server/core/repo/memory.js";
import { fixedClock, idFactory } from "../helpers.js";

describe("pipeline runner", () => {
  let repo: MemoryRepository;
  let deps: PipelineDeps;

  let clock: ReturnType<typeof fixedClock>;
  beforeEach(async () => {
    repo = new MemoryRepository();
    clock = fixedClock();
    const newId = idFactory(clock);
    deps = {
      repo,
      crm: new FixtureCrmAdapter(syntheticCases, clock.now),
      release: seedRelease,
      assessor: recordedAssessor(),
      drafter: recordedDrafter(),
      now: clock.now,
      newId,
      devPool: devProfiles.dev_pool,
      mode: "shadow",
    };
    await seedSyntheticProfiles(repo, {
      linkUserId: null,
      now: clock.now(),
      newId,
    });
  });

  async function enqueue(caseId: string, source = "synthetic") {
    const item = syntheticCases.find((entry) => entry.id === caseId);
    const receivedAt = deps.now().toISOString();
    const { record } = await repo.insertInboxIfAbsent({
      id: deps.newId(),
      source,
      externalId: caseId,
      receivedAt,
      signatureOk: true,
      payload: { ...item?.submission },
      status: "pending",
      attempts: 0,
      lastError: null,
      nextAttemptAt: null,
      version: 1,
      createdAt: receivedAt,
      updatedAt: receivedAt,
    });
    return record.id;
  }

  it("stores a duplicate delivery once", async () => {
    const first = await enqueue("direct-new-unowned");
    const second = await enqueue("direct-new-unowned");
    expect(second).toBe(first);
    expect(repo.counts().inbox).toBe(1);
  });

  it("runs each step once, drafts, and reports notify as skipped", async () => {
    const result = await runPipeline(await enqueue("direct-new-unowned"), deps);
    expect(result.status).toBe("done");
    expect(result.steps.map((step) => `${step.step}:${step.status}`)).toEqual([
      "normalize:done",
      "crm_snapshot:done",
      "assess_message:done",
      "precheck:done",
      "route:done",
      "score:done",
      "draft:done",
      "notify:skip",
    ]);
  });

  it("returns early for an inbox row that is already done", async () => {
    const id = await enqueue("student");
    await runPipeline(id, deps);
    const again = await runPipeline(id, deps);
    expect(again.status).toBe("done");
    expect(again.steps).toEqual([]);
  });

  it("rolls back a step that crashes mid-way and resumes from the database", async () => {
    const id = await enqueue("direct-new-unowned");
    let crash = true;
    const crashingRoute: PipelineStep = {
      ...STEPS[4],
      async run(stepDeps, state) {
        await stepDeps.repo.appendEvent({
          id: stepDeps.newId(),
          engagementId: state.engagement?.id ?? null,
          correlationId: state.inbox.id,
          type: "partial.write",
          actor: "system",
          payload: {},
          receiptId: null,
          occurredAt: stepDeps.now().toISOString(),
        });
        if (crash) throw new TransientStepError("worker died mid-step");
        return STEPS[4].run(stepDeps, state);
      },
    };
    const steps = [...STEPS.slice(0, 4), crashingRoute, ...STEPS.slice(5)];

    const first = await runPipeline(id, deps, steps);
    expect(first.status).toBe("pending");
    expect(first.steps[first.steps.length - 1]).toMatchObject({
      step: "route",
      status: "retry",
    });
    const events = await repo.listEventsByCorrelation(id);
    expect(events.some((event) => event.type === "partial.write")).toBe(false);
    expect(
      events.some((event) => event.type === "pipeline.retry_scheduled"),
    ).toBe(true);
    expect((await repo.getInbox(id))?.nextAttemptAt).not.toBeNull();

    crash = false;
    // A retry waits for its backoff; firing early claims nothing.
    const early = await runPipeline(id, deps, steps);
    expect(early.status).toBe("pending");
    expect(early.steps).toEqual([]);
    clock.advance(16 * 60_000);
    const second = await runPipeline(id, deps, steps);
    expect(second.status).toBe("done");
    expect(second.steps.slice(0, 4).every((step) => step.reused)).toBe(true);
    expect(
      await repo.listScorecards(second.engagementId as string),
    ).toHaveLength(1);
  });

  it("stops retrying after the attempt cap", async () => {
    const id = await enqueue("student");
    const alwaysTransient: PipelineStep = {
      ...STEPS[1],
      async isDone() {
        return false;
      },
      async run() {
        throw new TransientStepError("CRM timed out");
      },
    };
    const steps = [STEPS[0], alwaysTransient];
    let result = await runPipeline(id, deps, steps);
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      clock.advance(16 * 60_000);
      result = await runPipeline(id, deps, steps);
    }
    expect(result.status).toBe("failed");
    expect((await repo.getInbox(id))?.attempts).toBe(MAX_ATTEMPTS);
    const blocked = await runPipeline(id, deps, steps);
    expect(blocked.steps).toEqual([]);
  });

  it("retries an unclassified error (a dropped connection) instead of failing the lead", async () => {
    const id = await enqueue("student");
    const flaky: PipelineStep = {
      ...STEPS[1],
      async isDone() {
        return false;
      },
      async run() {
        throw new Error("Connection terminated unexpectedly");
      },
    };
    const result = await runPipeline(id, deps, [STEPS[0], flaky]);
    expect(result.status).toBe("pending");
    expect((await repo.getInbox(id))?.status).toBe("pending");
  });

  it("does not run a claim that another run still holds, and recovers it after the lease", async () => {
    const id = await enqueue("student");
    const inbox = (await repo.getInbox(id))!;
    await repo.updateInbox(
      id,
      {
        status: "processing",
        attempts: 1,
        updatedAt: clock.now().toISOString(),
      },
      inbox.version,
    );
    const held = await runPipeline(id, deps);
    expect(held.steps).toEqual([]);
    expect(held.status).toBe("pending");
    clock.advance(CLAIM_LEASE_MS + 1);
    const recovered = await runPipeline(id, deps);
    expect(recovered.status).toBe("done");
  });

  it("marks a crash-looping row failed at the cap instead of claiming it again", async () => {
    const id = await enqueue("student");
    const inbox = (await repo.getInbox(id))!;
    await repo.updateInbox(
      id,
      {
        status: "processing",
        attempts: MAX_ATTEMPTS,
        updatedAt: clock.now().toISOString(),
      },
      inbox.version,
    );
    clock.advance(CLAIM_LEASE_MS + 1);
    const result = await runPipeline(id, deps);
    expect(result.status).toBe("failed");
    expect(result.steps).toEqual([]);
    expect((await repo.getInbox(id))?.status).toBe("failed");
  });

  it("fails to human review on invalid agent output without retrying", async () => {
    const id = await enqueue("agency-already-sal");
    const result = await runPipeline(id, {
      ...deps,
      assessor: {
        source: "test",
        async assess() {
          return {
            intent: "sales",
            agency_signal: true,
            evidence_quotes: ["made up quote"],
            end_client_named: false,
            product_interest: "unknown",
            language: "en",
            explicit_question: null,
          };
        },
      },
    });
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/not an exact substring/);
    expect((await repo.getInbox(id))?.status).toBe("failed");
  });

  it("halts without running later steps", async () => {
    const id = await enqueue("vendor-pitch");
    const halting: PipelineStep = {
      ...STEPS[0],
      async run() {
        return { status: "halt", reason: "ignored" };
      },
    };
    const result = await runPipeline(id, deps, [halting, STEPS[1]]);
    expect(result.status).toBe("done");
    expect(result.steps).toEqual([
      { step: "normalize", status: "halt", reason: "ignored", reused: false },
    ]);
  });
});
