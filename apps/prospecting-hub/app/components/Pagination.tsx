import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";

// Ported from apps/li-agent/app/components/Pagination.tsx: page-number
// navigation (prev/next arrows + a jump-to-page dropdown + "start-end of
// total"), not an accumulating "Load more" -- each page replaces what's
// shown rather than appending to it.
export function Pagination({
  page,
  pageSize,
  totalCount,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
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
        aria-label="Page"
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
    </div>
  );
}
