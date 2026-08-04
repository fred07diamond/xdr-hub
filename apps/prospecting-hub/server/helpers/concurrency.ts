// Bounded-concurrency map — runs `fn` over `items` with at most
// `concurrency` in flight at once, instead of one-at-a-time. Extracted
// after a live-confirmed incident: a single CommonRoom `commonroom_list_objects`
// call took ~16s during a genuine CommonRoom slowdown, and rescore-
// contacts.ts/score-contacts.ts were processing contacts sequentially — 8
// contacts at ~16-20s each (~128-160s total) blew well past the hosting
// platform's 75s function timeout even after the two CommonRoom calls
// *within* a single contact's lookup were parallelized. Running contacts
// themselves concurrently bounds a chunk's wall-clock time by the slowest
// single contact instead of the sum of all of them.
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await fn(items[current], current);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
