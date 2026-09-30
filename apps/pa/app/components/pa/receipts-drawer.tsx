import type { ReceiptSummary } from "@shared/pa-views";
import { IconChevronLeft, IconReceipt } from "@tabler/icons-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useReceipt } from "@/hooks/use-pa-data";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { CitationChips, ReleaseChip } from "./badges";
import { ErrorState } from "./states";

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <section className="space-y-1.5">
      <h4 className="text-[12px] font-medium text-muted-foreground">{label}</h4>
      <pre className="max-h-80 overflow-auto rounded-md border border-border bg-muted/50 p-3 font-mono text-[11.5px] leading-relaxed text-foreground">
        {JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}

function ReceiptDetailView({
  receiptId,
  onBack,
}: {
  receiptId: string;
  onBack: () => void;
}) {
  const receipt = useReceipt(receiptId);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-5 py-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-[4px] text-[12.5px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <IconChevronLeft className="size-4" aria-hidden="true" />
          All receipts
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {receipt.isPending ? (
          <div className="space-y-3" aria-busy="true">
            <div className="h-5 w-40 animate-pulse rounded bg-muted" />
            <div className="h-32 animate-pulse rounded bg-muted" />
          </div>
        ) : receipt.isError || !receipt.data ? (
          <ErrorState
            title="Receipt unavailable"
            error={receipt.error}
            onRetry={() => void receipt.refetch()}
          />
        ) : (
          <>
            <div className="space-y-2">
              <h3 className="text-[15px] font-semibold text-foreground">
                {receipt.data.label}
              </h3>
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                <span className="font-mono">{receipt.data.kind}</span>
                <span aria-hidden="true">/</span>
                <time dateTime={receipt.data.createdAt}>
                  {formatDateTime(receipt.data.createdAt)}
                </time>
                <ReleaseChip shortId={receipt.data.release.shortId} />
              </div>
              <p className="text-[12px] text-muted-foreground">
                {receipt.data.model
                  ? `Agent run ${receipt.data.agentRunId ?? "unknown"} on ${receipt.data.model}`
                  : "Deterministic step. No model was involved."}
              </p>
            </div>
            {receipt.data.entries.length > 0 ? (
              <section className="space-y-1.5">
                <h4 className="text-[12px] font-medium text-muted-foreground">
                  Playbook entries cited
                </h4>
                <CitationChips entries={receipt.data.entries} />
              </section>
            ) : null}
            <JsonBlock label="Rule results" value={receipt.data.ruleResults} />
            <JsonBlock label="Inputs" value={receipt.data.inputs} />
          </>
        )}
      </div>
    </div>
  );
}

export function ReceiptsDrawer({
  open,
  onOpenChange,
  receipts,
  selectedId,
  onSelect,
  releaseShortId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receipts: ReceiptSummary[];
  selectedId: string | null;
  onSelect: (receiptId: string | null) => void;
  releaseShortId: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4 pr-12">
          <div className="min-w-0">
            <SheetTitle className="text-[15px]">Receipts</SheetTitle>
            <SheetDescription className="text-[12.5px]">
              Why each step decided what it did, pinned to the playbook release.
            </SheetDescription>
          </div>
          <ReleaseChip shortId={releaseShortId} className="mt-0.5 shrink-0" />
        </div>
        {selectedId ? (
          <ReceiptDetailView
            receiptId={selectedId}
            onBack={() => onSelect(null)}
          />
        ) : (
          <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
            {receipts.map((receipt) => (
              <li key={receipt.id}>
                <button
                  type="button"
                  onClick={() => onSelect(receipt.id)}
                  className={cn(
                    "flex w-full items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none",
                  )}
                >
                  <IconReceipt
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-[13px] font-medium text-foreground">
                        {receipt.label}
                      </span>
                      <time
                        dateTime={receipt.createdAt}
                        className="shrink-0 text-[11.5px] text-muted-foreground"
                      >
                        {formatDateTime(receipt.createdAt)}
                      </time>
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">
                      {receipt.summary}
                    </span>
                    <CitationChips
                      entries={receipt.entries}
                      className="mt-1.5"
                    />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
