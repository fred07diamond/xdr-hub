import {
  createScorer,
  defineEval,
  type AgentRunOutput,
} from "@agent-native/core/eval";

import { createUlidFactory } from "../server/core/ids.js";
import { seedRelease } from "../server/core/playbook/release.js";
import {
  replaySyntheticCases,
  syntheticCases,
  type ReplayCaseResult,
} from "../server/core/replay/index.js";
import { MemoryRepository } from "../server/core/repo/memory.js";

// Deterministic: replays through the real pipeline in memory with recorded
// assessments. No model call, no network, no database.
const REPLAY_AT = new Date("2026-09-29T17:00:00.000Z");

async function replayCase(caseId: string): Promise<AgentRunOutput> {
  const started = Date.now();
  const next = createUlidFactory();
  const [result] = await replaySyntheticCases({
    repo: new MemoryRepository(),
    release: seedRelease,
    now: () => REPLAY_AT,
    newId: () => next(REPLAY_AT.getTime()),
    caseId,
    linkUserId: null,
  });
  return {
    text: JSON.stringify(result),
    toolCalls: [],
    ok: result.pipeline === "done",
    error: result.error ?? undefined,
    runId: `replay-${caseId}`,
    durationMs: Date.now() - started,
  };
}

function outcomeScorer(field: "precheck" | "route" | "verdict") {
  return createScorer<ReplayCaseResult>({
    name: `${field}-matches-label`,
    preprocess: (run) => JSON.parse(run.text) as ReplayCaseResult,
    generateScore: (result) => (result.matches[field] ? 1 : 0),
    generateReason: ({ analysis }) =>
      `${field}: expected ${analysis.expected[field]}, got ${analysis.actual[field] ?? "nothing"}`,
  });
}

export const pipelineOutcomeEvals = syntheticCases.map((fixture) =>
  defineEval({
    name: `pipeline-outcome/${fixture.id}`,
    input: { prompt: `Replay synthetic case ${fixture.id} in shadow mode.` },
    run: () => replayCase(fixture.id),
    scorers: [
      outcomeScorer("precheck"),
      outcomeScorer("route"),
      outcomeScorer("verdict"),
    ],
    threshold: 1,
  }),
);
