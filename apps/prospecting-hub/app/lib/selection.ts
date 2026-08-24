// Ported from apps/li-agent/app/lib/selection.ts: shift-click range select
// for row checkboxes -- the standard "select a range of rows" behavior from
// Gmail/Finder/etc. A plain click still just toggles the one row; shift-click
// adds every row between the last clicked row and this one to the selection.
//
// The anchor is tracked by row id, not index -- data can refetch on a
// polling interval, and re-resolving the anchor's position in the current
// `rows` array on every call means a background refresh can never leave the
// anchor pointing at the wrong row. If the anchor row isn't in `rows`
// anymore, shift-click just falls back to a normal single toggle.
export function applyShiftClickSelection<T extends { id: string }>(
  rows: T[],
  clickedIndex: number,
  shiftKey: boolean,
  anchorId: string | null,
  selected: Set<string>,
): Set<string> {
  const clickedId = rows[clickedIndex]?.id;
  if (!clickedId) return selected;

  const next = new Set(selected);
  const anchorIndex = anchorId ? rows.findIndex((r) => r.id === anchorId) : -1;
  if (shiftKey && anchorIndex !== -1) {
    const start = Math.min(anchorIndex, clickedIndex);
    const end = Math.max(anchorIndex, clickedIndex);
    for (let i = start; i <= end; i++) {
      const id = rows[i]?.id;
      if (id) next.add(id);
    }
  } else if (next.has(clickedId)) {
    next.delete(clickedId);
  } else {
    next.add(clickedId);
  }
  return next;
}
