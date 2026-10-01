// How the inbound board orders and narrows its rows. Newest first is the
// default so a new Contact Sales request lands at the top the moment it is
// pulled; "Most urgent" keeps the server's SLA order (breached, at risk, then
// by due time). Shared by the board and the lead page's next and previous.
import type { BoardRow } from "@shared/pa-views";

export const BOARD_SORTS = [
  { id: "newest", label: "Newest first" },
  { id: "urgent", label: "Most urgent" },
] as const;
export type BoardSort = (typeof BOARD_SORTS)[number]["id"];

export const BOARD_WINDOWS = [
  { id: "all", label: "Any time", hours: null },
  { id: "24h", label: "Last 24 hours", hours: 24 },
  { id: "7d", label: "Last 7 days", hours: 24 * 7 },
  { id: "30d", label: "Last 30 days", hours: 24 * 30 },
] as const;
export type BoardWindow = (typeof BOARD_WINDOWS)[number]["id"];

export function parseSort(value: string | null): BoardSort {
  return BOARD_SORTS.some((item) => item.id === value)
    ? (value as BoardSort)
    : "newest";
}

export function parseWindow(value: string | null): BoardWindow {
  return BOARD_WINDOWS.some((item) => item.id === value)
    ? (value as BoardWindow)
    : "all";
}

/** A lead submitted this recently gets the New mark on the board. */
export const NEW_LEAD_MINUTES = 60;

export function isNewLead(row: BoardRow, now: number) {
  return now - Date.parse(row.submittedAt) < NEW_LEAD_MINUTES * 60_000;
}

export function arrangeRows(
  rows: BoardRow[],
  options: { sort: BoardSort; within: BoardWindow; now: number },
): BoardRow[] {
  const hours = BOARD_WINDOWS.find((item) => item.id === options.within)?.hours;
  const since = hours ? options.now - hours * 3_600_000 : null;
  const kept =
    since === null
      ? rows
      : rows.filter((row) => Date.parse(row.submittedAt) >= since);
  if (options.sort === "urgent") return kept;
  return [...kept].sort(
    (a, b) =>
      b.submittedAt.localeCompare(a.submittedAt) || a.id.localeCompare(b.id),
  );
}

/** The board query a lead link carries, so next and previous follow it. */
export function boardQuery(input: {
  tab: string;
  sort: BoardSort;
  within: BoardWindow;
}) {
  const params = new URLSearchParams({ tab: input.tab });
  if (input.sort !== "newest") params.set("sort", input.sort);
  if (input.within !== "all") params.set("within", input.within);
  return params.toString();
}
