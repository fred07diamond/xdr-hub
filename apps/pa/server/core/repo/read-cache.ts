// One page load reads each record once (D74). The board and the lead page
// work out the class, the route, and the live recommendation per lead, and
// each of those re-read the same submissions, receipts, and people; with
// two dozen leads that was thousands of queries per load. Reads are cached
// for the life of one view build only, and each caller gets its own copy so
// sorting or mutating a result cannot leak between callers.
import type { PaRepository } from "./types.js";

const READ = /^(get|list|find)/;

export function withReadCache(repo: PaRepository): PaRepository {
  const cache = new Map<string, Promise<unknown>>();
  return new Proxy(repo, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== "function") return value;
      const fn = value as (...args: unknown[]) => unknown;
      if (typeof prop !== "string" || !READ.test(prop)) return fn.bind(target);
      return async (...args: unknown[]) => {
        const key = `${prop}:${JSON.stringify(args)}`;
        let hit = cache.get(key);
        if (!hit) {
          hit = Promise.resolve(fn.apply(target, args));
          cache.set(key, hit);
          // A failed read is not kept; the next caller tries again.
          hit.catch(() => cache.delete(key));
        }
        const result = await hit;
        return result === undefined ? result : structuredClone(result);
      };
    },
  });
}
