// Sidebar ordering for Lead Lists. Extracted from the route so it is a pure,
// directly testable function rather than something only reachable by
// rendering a page.

/**
 * Sidebar sort options.
 *
 * "Newest" is the default and sorts on createdAt, which is deliberately the
 * field the row already DISPLAYS ("Created Aug 19"). Sorting on updatedAt
 * would arguably be more useful -- adding leads to an old list would surface
 * it -- but the visible dates would then appear out of order, which looks like
 * a bug rather than a feature.
 */
export const LIST_SORTS = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "name", label: "Name" },
  { value: "size", label: "Most leads" },
] as const;

export type ListSort = (typeof LIST_SORTS)[number]["value"];

export const LIST_SORT_STORAGE_KEY = "li.leadLists.sort";

export function sortLeadLists<T extends { name: string; createdAt: string | null; totalCount: number }>(
  lists: T[],
  sort: ListSort,
): T[] {
  // Copy first: the query's data array is shared, and sorting in place would
  // mutate react-query's cache.
  const out = [...lists];
  const time = (v: string | null) => {
    if (!v) return 0;
    const t = new Date(v).getTime();
    // An unparseable date sorts oldest rather than throwing the comparator
    // into NaN, which would leave the whole list in an arbitrary order.
    return Number.isNaN(t) ? 0 : t;
  };
  switch (sort) {
    case "oldest":
      return out.sort((a, b) => time(a.createdAt) - time(b.createdAt));
    case "name":
      return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    case "size":
      // Tie-break by recency so a screen full of empty lists is not itself
      // randomly ordered.
      return out.sort((a, b) => b.totalCount - a.totalCount || time(b.createdAt) - time(a.createdAt));
    default:
      return out.sort((a, b) => time(b.createdAt) - time(a.createdAt));
  }
}
