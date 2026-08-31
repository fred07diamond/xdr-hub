import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useEffect, useState } from "react";

// Page-number navigation (prev/next arrows + a jump-to-page dropdown +
// "start-end of total"), not an accumulating "Load more" -- each page
// replaces what's shown rather than appending to it.
//
// onPageSizeChange is optional: pass it to also show a free-form "rows per
// page" input next to the page controls, instead of the caller's page size
// being a fixed constant with no way for the user to see more (or fewer)
// rows at once. Omit it to keep pageSize purely fixed, as before.
export function Pagination({
  page,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const [pageSizeInput, setPageSizeInput] = useState(String(pageSize));

  // Keep the input in sync when pageSize changes from outside (e.g. the
  // caller clamps it, or resets on a filter change) without fighting
  // whatever the user is actively typing -- only overwrite once it settles
  // back to matching the committed value.
  useEffect(() => {
    setPageSizeInput(String(pageSize));
  }, [pageSize]);

  function commitPageSize() {
    const parsed = Math.floor(Number(pageSizeInput));
    if (Number.isFinite(parsed) && parsed > 0) {
      onPageSizeChange?.(parsed);
    } else {
      setPageSizeInput(String(pageSize));
    }
  }

  const start = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="rounded-md border border-border p-1 hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
        aria-label="Previous page"
      >
        <IconChevronLeft size={14} />
      </button>
      <select
        value={page}
        onChange={(e) => onPageChange(Number(e.target.value))}
        className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="rounded-md border border-border p-1 hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
        aria-label="Next page"
      >
        <IconChevronRight size={14} />
      </button>
      <span className="tabular-nums">
        {start}-{end} of {totalCount.toLocaleString()}
      </span>
      {onPageSizeChange && (
        <label className="flex items-center gap-1">
          <span>Rows:</span>
          <input
            type="number"
            min={1}
            value={pageSizeInput}
            onChange={(e) => setPageSizeInput(e.target.value)}
            onBlur={commitPageSize}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
              }
            }}
            className="w-16 rounded-md border border-border bg-background px-1.5 py-1 text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label="Rows per page"
          />
        </label>
      )}
    </div>
  );
}
