import { IconSparkles } from "@tabler/icons-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useApolloEnrichment } from "@/lib/apollo-enrichment";
import { CREDITS_PER_EMAIL, formatCreditCount } from "@/lib/apollo-limits";
import { useState } from "react";

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

  /**
   * The ceiling is CREDITS, not a record count.
   *
   * There used to be a flat MAX_BULK_ENRICH = 50 here as well, and it was the
   * wrong unit: 50 emails is 50 credits while 50 phone reveals is 400, so a
   * record cap prices two runs that differ eightfold as if they were the same.
   * On a real list it also just got in the way -- the cap, not the budget, was
   * the thing stopping the work.
   *
   * What remains is the honest limit: how many the workspace can afford, and
   * how many were selected. The server enforces the budget regardless; this is
   * so the button states the real number instead of an optimistic one.
   */
  const affordable = remaining == null ? selectedCount : Math.min(selectedCount, remaining);
  // How many to run, editable. Null falls back to everything affordable, so
  // the default is useful rather than an arbitrary 50.
  const [wanted, setWanted] = useState<number | null>(null);
  const willProcess = Math.max(0, Math.min(wanted ?? affordable, affordable));
  const cost = willProcess * CREDITS_PER_EMAIL;

  const budgetLimited = remaining != null && selectedCount > remaining;
  const APPROX_SECONDS_PER_CALL = 2;
  const estSeconds = willProcess * APPROX_SECONDS_PER_CALL;
  const estLabel = estSeconds < 60 ? `${estSeconds}s` : `${Math.round(estSeconds / 60)} min`;

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
            <p className="mb-2 text-sm font-semibold">
              {budgetLimited
                ? `Only ${formatCreditCount(remaining ?? 0)} credits left this period`
                : `Enrich ${willProcess} lead${willProcess === 1 ? "" : "s"}`}
            </p>

            {/* How many, as an input rather than a fixed cap. */}
            <div className="mb-2 flex items-center gap-2">
              <label htmlFor="enrich-count" className="text-muted-foreground">
                How many
              </label>
              <input
                id="enrich-count"
                type="number"
                min={0}
                max={affordable}
                value={willProcess}
                onChange={(e) => {
                  const raw = e.target.value;
                  // Empty clears back to everything affordable rather than
                  // pinning the run to zero.
                  if (raw === "") return setWanted(null);
                  const n = Number.parseInt(raw, 10);
                  if (Number.isFinite(n)) setWanted(Math.max(0, Math.min(affordable, n)));
                }}
                className="w-20 rounded border border-border bg-background px-1.5 py-0.5 text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                type="button"
                onClick={() => setWanted(affordable)}
                className="text-[11px] text-muted-foreground underline hover:text-foreground"
              >
                all {affordable.toLocaleString()}
              </button>
            </div>

            {willProcess < selectedCount && (
              <p className="mb-2 text-muted-foreground">
                {/* Which leads survive the cut matters: sorted best-first, so a
                    partial run spends on the leads most worth it rather than
                    whichever sat at the top of the Sales Nav order. */}
                You selected {selectedCount.toLocaleString()}. We will enrich the{" "}
                {willProcess.toLocaleString()} highest-fit and stop.
              </p>
            )}

            <p className="mb-2 text-muted-foreground">
              {willProcess} email{willProcess === 1 ? "" : "s"} × {CREDITS_PER_EMAIL} credit ={" "}
              <strong className="text-foreground">{formatCreditCount(cost)} credits</strong>
              {willProcess > 0 && <> · about {estLabel} to run</>}
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
