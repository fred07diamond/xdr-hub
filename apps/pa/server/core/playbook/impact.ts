// Impact preview (D44): replays the synthetic cases, and the labeled set once
// it exists, through the real pipeline under the base and the draft release.
// In memory, with recorded assessments: no model call, network, or database.
import { createUlidFactory } from "../ids.js";
import { replaySyntheticCases } from "../replay/index.js";
import { MemoryRepository } from "../repo/memory.js";
import type { ImpactCase } from "./changes.js";
import type { PlaybookRelease } from "./schema.js";

// A fixed Tuesday morning, so clocks and working hours never make the diff.
const REPLAY_AT = new Date("2026-09-29T17:00:00.000Z");

async function outcomes(release: PlaybookRelease) {
  const next = createUlidFactory();
  const results = await replaySyntheticCases({
    repo: new MemoryRepository(),
    release,
    now: () => REPLAY_AT,
    newId: () => next(REPLAY_AT.getTime()),
    linkUserId: null,
  });
  return new Map(
    results.map((result) => [
      result.caseId,
      {
        precheck: result.actual?.precheck ?? null,
        route: result.actual?.route ?? null,
        verdict: result.actual?.verdict ?? null,
        state: result.actual?.state ?? null,
        pipeline: result.pipeline,
      } as Record<string, string | null>,
    ]),
  );
}

export async function replayImpact(
  base: PlaybookRelease,
  draft: PlaybookRelease,
): Promise<ImpactCase[]> {
  const [before, after] = await Promise.all([outcomes(base), outcomes(draft)]);
  return [...before.keys()].map((caseId) => {
    const was = before.get(caseId) ?? {};
    const now = after.get(caseId) ?? {};
    return {
      caseId,
      before: was,
      after: now,
      changed: JSON.stringify(was) !== JSON.stringify(now),
    };
  });
}
