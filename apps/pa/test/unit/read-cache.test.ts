// One view build reads each record once (D74).
import { describe, expect, it } from "vitest";

import { seedRelease } from "../../server/core/playbook/release.js";
import { replaySyntheticCases } from "../../server/core/replay/index.js";
import { MemoryRepository } from "../../server/core/repo/memory.js";
import { withReadCache } from "../../server/core/repo/read-cache.js";
import type { PaRepository } from "../../server/core/repo/types.js";
import { buildInboundBoard } from "../../server/core/views/inbound.js";
import { fixedClock, idFactory } from "../helpers.js";

function counting(repo: PaRepository) {
  const calls = { n: 0 };
  const proxy = new Proxy(repo, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        calls.n += 1;
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { proxy: proxy as PaRepository, calls };
}

describe("withReadCache", () => {
  it("serves repeat reads from the cache, as copies", async () => {
    const repo = new MemoryRepository();
    const { proxy, calls } = counting(repo);
    const cached = withReadCache(proxy);
    const first = await cached.listEngagements();
    const second = await cached.listEngagements();
    expect(calls.n).toBe(1);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it("cuts the reads behind the inbound board", async () => {
    const repo = new MemoryRepository();
    const clock = fixedClock();
    await replaySyntheticCases({
      repo,
      release: seedRelease,
      now: clock.now,
      newId: idFactory(clock),
      linkUserId: "dev@local.test",
    });
    const { proxy, calls } = counting(repo);
    const board = await buildInboundBoard({
      repo: proxy,
      release: seedRelease,
      viewer: { userId: null, canReplay: false },
      tab: "team",
      state: null,
      now: clock.now(),
    });
    expect(board.rows.length).toBeGreaterThan(0);
    // Without the cache this board took several hundred reads.
    expect(calls.n).toBeLessThan(board.rows.length * 30);
  });
});
