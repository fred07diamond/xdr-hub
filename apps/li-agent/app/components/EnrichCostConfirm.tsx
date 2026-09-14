import { IconSparkles } from "@tabler/icons-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useApolloEnrichment } from "@/lib/apollo-enrichment";
import { CREDITS_PER_EMAIL, MAX_BULK_ENRICH, formatCreditCount } from "@/lib/apollo-limits";

// Shown before a bulk enrich commits, so the cost is visible BEFORE the
// credits are spent rather than discovered afterwards on the Analytics page.
//
// Three cases, because they need different copy: a normal run, a selection
// over the batch cap, and a selection larger than the credits remaining.

export interface EnrichCostConfirmProps {
  /** How many records the user actually selected. */
  selectedCount: number;
  /** Label for the trigger button. */
  label: string;
  disabled?: boolean;
  /** Called with the number of records to actually process. */
  onConfirm: (limit: number) => void;
}

export function EnrichCostConfirm({ selectedCount, label, disabled, onConfirm }: EnrichCostConfirmProps) {
  const apollo = useApolloEnrichment();
  const remaining = apollo.status?.remaining ?? null;
  const resetLabel = apollo.status?.resetLabel ?? null;

  // Three ceilings, smallest wins: what was selected, the batch cap, and what
  // the workspace can still afford. Computed here so the button label states
  // the real number rather than the optimistic one.
  const cappedByBatch = Math.min(selectedCount, MAX_BULK_ENRICH);
  const affordable = remaining == null ? cappedByBatch : Math.min(cappedByBatch, remaining);
  const willProcess = Math.max(0, affordable);
  const cost = willProcess * CREDITS_PER_EMAIL;

  const overCap = selectedCount > MAX_BULK_ENRICH;
  const budgetLimited = remaining != null && cappedByBatch > remaining;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled || selectedCount === 0}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          <IconSparkles size={12} />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 text-xs">
        {willProcess === 0 ? (
          <>
            <p className="mb-1 text-sm font-semibold">No credits left this period</p>
            <p className="text-muted-foreground">
              The workspace has used its Apollo credits.
              {resetLabel ? ` They reset ${resetLabel}.` : ""}
            </p>
          </>
        ) : (
          <>
            <p className="mb-1 text-sm font-semibold">
              {budgetLimited
                ? `Only ${formatCreditCount(remaining ?? 0)} credits left this period`
                : overCap
                  ? "Too many leads selected"
                  : `Enrich ${willProcess} lead${willProcess === 1 ? "" : "s"}`}
            </p>

            {overCap && !budgetLimited && (
              <p className="mb-2 text-muted-foreground">
                You selected <strong className="text-foreground">{selectedCount} leads</strong>. Bulk
                enrich is capped at <strong className="text-foreground">{MAX_BULK_ENRICH}</strong> per
                run to keep Apollo spend predictable.
                {/* Stated explicitly because it is what makes the cap a
                    steering mechanism rather than an arbitrary cut: the leads
                    that survive truncation are the best ones, not the first
                    ones in Sales Nav order. */}
                <br />
                We will start with your {MAX_BULK_ENRICH} highest-fit leads.
              </p>
            )}

            {budgetLimited && (
              <p className="mb-2 text-muted-foreground">
                You selected {selectedCount} lead{selectedCount === 1 ? "" : "s"}. We will enrich the{" "}
                {willProcess} highest-fit and stop.
              </p>
            )}

            <p className="mb-2 text-muted-foreground">
              {willProcess} email{willProcess === 1 ? "" : "s"} × {CREDITS_PER_EMAIL} credit ={" "}
              <strong className="text-foreground">{formatCreditCount(cost)} credits</strong>
              <br />
              {/* Worth saying, so nobody assumes a bulk run buys numbers too:
                  a reveal is 8x and always one at a time. */}
              No phone reveals — those are one at a time, 8 credits each.
            </p>

            {remaining != null && (
              <p className="mb-3 text-muted-foreground">
                <strong className="text-foreground">{formatCreditCount(remaining)}</strong> credits left
                {resetLabel ? `, resets ${resetLabel}` : ""}.
              </p>
            )}

            <button
              type="button"
              onClick={() => onConfirm(willProcess)}
              className="w-full rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              Enrich {willProcess} lead{willProcess === 1 ? "" : "s"} · {formatCreditCount(cost)} credits
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
