import { IconCheck, IconDownload, IconLoader2, IconX } from "@tabler/icons-react";
import { useMemo, useState } from "react";

import { useCreditUsage, type CreditUsage } from "@/components/ApolloCreditGauge";
import { useApolloEnrichment } from "@/lib/apollo-enrichment";
import { MAX_BULK_ENRICH } from "@/lib/apollo-limits";
import { buildMasterCsv, CSV_HEADER, csvRowCells, type CsvRow } from "@/lib/prospects-csv";

/**
 * Preview-and-confirm step before a CSV leaves the app.
 *
 * Modelled on Apollo's own upload dialog: show the real columns with real
 * sample rows, say how many records are going, and put the enrichment choice
 * and its credit cost in a summary beside it. The point is that the file gets
 * checked BEFORE it is written, rather than downloaded, opened, found to be
 * half-empty, and regenerated.
 *
 * One deliberate divergence from Apollo's version: this offers to fill in
 * missing EMAILS only, never phone numbers. Phone reveals are 8 credits each
 * and this app makes them a single, deliberate, fit-gated action -- a "reveal
 * 40 phones" checkbox here would quietly undo that, which is the exact leak
 * the credit work closed. Apollo's dialog can offer it because Apollo is not
 * trying to stop anyone spending.
 */

/**
 * Generic over the row type rather than narrowing to CsvRow.
 *
 * Callers hold richer records (LeadListItem, Prospect) that merely SATISFY
 * CsvRow, and an `onEnrich` typed on CsvRow would be contravariant-unsound for
 * them -- it would have to accept a bare CsvRow it cannot enrich. Keeping the
 * caller's own type means no cast at either end.
 */
export interface CsvExportModalProps<T extends CsvRow> {
  open: boolean;
  onClose: () => void;
  /** Every row that would go into the file. */
  rows: T[];
  /** Download filename, without the date suffix or extension. */
  filenamePrefix: string;
  /**
   * Enriches the given rows and resolves with the updated set. Omit to hide
   * the enrichment option entirely (e.g. a surface with no enrich action).
   */
  onEnrich?: (rows: T[]) => Promise<T[]>;
  title?: string;
}

const PREVIEW_ROWS = 5;

export function CsvExportModal<T extends CsvRow>({
  open,
  onClose,
  rows,
  filenamePrefix,
  onEnrich,
  title = "Export CSV",
}: CsvExportModalProps<T>) {
  const apollo = useApolloEnrichment();
  const { data: usageRaw } = useCreditUsage();
  const usage = usageRaw as CreditUsage | undefined;

  const [enrichFirst, setEnrichFirst] = useState(false);
  const [busy, setBusy] = useState<null | "enriching" | "writing">(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const missingEmail = useMemo(() => rows.filter((r) => !r.enrichedEmail), [rows]);

  // The batch cap applies here too. Without it, "export 400 leads and enrich
  // the missing ones" would be a single click authorizing 400 Apollo calls.
  const enrichable = Math.min(missingEmail.length, MAX_BULK_ENRICH);
  const creditCost = enrichable; // one credit per email
  const remaining = usage?.remaining ?? null;
  const personalRemaining = usage?.mine?.remaining ?? null;
  // Fail closed in the display: if either ceiling cannot cover it, say so
  // rather than letting the run stop halfway.
  const overWorkspace = remaining != null && creditCost > remaining;
  const overPersonal = personalRemaining != null && creditCost > personalRemaining;
  const canEnrich = !!onEnrich && apollo.enabled && enrichable > 0 && !overWorkspace && !overPersonal;

  if (!open) return null;

  function download(finalRows: T[]) {
    const csv = buildMasterCsv(finalRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleConfirm() {
    setError(null);
    let finalRows: T[] = rows;

    if (enrichFirst && onEnrich && canEnrich) {
      setBusy("enriching");
      setProgress(`Enriching ${enrichable} ${enrichable === 1 ? "record" : "records"}…`);
      try {
        finalRows = await onEnrich(missingEmail.slice(0, MAX_BULK_ENRICH));
      } catch (err) {
        // Deliberately does NOT fall through to the download. Someone who
        // asked for an enriched file should not silently receive the
        // unenriched one -- they would send it and never know.
        setError(
          err instanceof Error
            ? `${err.message} Nothing was exported — uncheck enrichment to export what you already have.`
            : "Enrichment failed. Nothing was exported.",
        );
        setBusy(null);
        setProgress(null);
        return;
      }
    }

    setBusy("writing");
    setProgress(null);
    download(finalRows);
    setBusy(null);
    onClose();
  }

  const preview = rows.slice(0, PREVIEW_ROWS);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        // Backdrop click closes, but never mid-run: losing the dialog while an
        // enrichment is in flight would leave spend with no visible outcome.
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-3xl rounded-xl border border-border bg-card shadow-lg">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={!!busy}
            aria-label="Close"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <IconX size={16} />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <p className="text-xs text-muted-foreground">
            These are the columns Apollo maps on import. Check the sample rows before writing the file.
          </p>

          {/* The real header, from the real builder -- not a hand-written copy
              that could describe columns the file does not have. */}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  {CSV_HEADER.map((h) => (
                    <th key={h} className="whitespace-nowrap px-2.5 py-1.5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => {
                  // The same cell values the file gets, straight from the
                  // builder -- not parsed back out of CSV text, which shifts
                  // columns the moment a field contains a comma.
                  const cells = csvRowCells(row);
                  return (
                    <tr key={i} className="border-b border-border/50 last:border-0">
                      {CSV_HEADER.map((h, ci) => (
                        <td
                          key={h}
                          className={`max-w-[160px] truncate px-2.5 py-1.5 ${cells[ci] ? "text-foreground" : "text-muted-foreground/50"}`}
                          title={cells[ci] || "empty"}
                        >
                          {cells[ci] || "—"}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > PREVIEW_ROWS && (
            <p className="text-[11px] text-muted-foreground">
              Showing {PREVIEW_ROWS} of {rows.length.toLocaleString()} rows.
            </p>
          )}

          {/* Summary panel, Apollo's layout: records, the enrichment toggle,
              and the credit total together. */}
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-2xl font-semibold tabular-nums text-foreground">
              {rows.length.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground">
              {rows.length === 1 ? "record to export" : "records to export"} ·{" "}
              {(rows.length - missingEmail.length).toLocaleString()} already have an email
            </p>

            {onEnrich && (
              <div className="mt-3 border-t border-border/60 pt-3">
                {missingEmail.length === 0 ? (
                  <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                    <IconCheck size={13} /> Every record already has an email. No credits needed.
                  </p>
                ) : !apollo.enabled ? (
                  <p className="text-xs text-muted-foreground">
                    {missingEmail.length.toLocaleString()} {missingEmail.length === 1 ? "record has" : "records have"}{" "}
                    no email. Enrichment is currently off, so they will export blank.
                  </p>
                ) : (
                  <>
                    <label className="flex cursor-pointer items-start gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={enrichFirst}
                        disabled={!canEnrich || !!busy}
                        onChange={(e) => setEnrichFirst(e.target.checked)}
                        className="mt-0.5 shrink-0"
                      />
                      <span>
                        <span className="font-medium text-foreground">
                          Find the missing {enrichable === 1 ? "email" : "emails"} first
                        </span>
                        <span className="block text-muted-foreground">
                          {missingEmail.length.toLocaleString()}{" "}
                          {missingEmail.length === 1 ? "record has" : "records have"} no email
                          {missingEmail.length > MAX_BULK_ENRICH && (
                            <> — capped at {MAX_BULK_ENRICH} per run, so {enrichable} would be attempted</>
                          )}
                          .
                        </span>
                      </span>
                    </label>

                    <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
                      <span className="text-muted-foreground">Credit total</span>
                      <span className="font-semibold tabular-nums text-foreground">
                        {enrichFirst ? creditCost.toLocaleString() : 0}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                      1 credit per email. Apollo only charges when it actually has one, so records it cannot
                      find cost nothing.
                      {remaining != null && <> {remaining.toLocaleString()} credits left this period.</>}
                    </p>
                    {/* No phone option here, and that is deliberate -- see the
                        note at the top of this file. */}
                    <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                      Phone numbers are not filled in from here. A reveal costs 8 credits and stays a
                      per-lead decision.
                    </p>

                    {overWorkspace && (
                      <p className="mt-1.5 text-[11px] text-destructive">
                        That would need {creditCost.toLocaleString()} credits and the workspace has{" "}
                        {remaining?.toLocaleString()} left.
                      </p>
                    )}
                    {!overWorkspace && overPersonal && (
                      <p className="mt-1.5 text-[11px] text-destructive">
                        That would need {creditCost.toLocaleString()} credits and your own allowance has{" "}
                        {personalRemaining?.toLocaleString()} left.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
              {error}
            </p>
          )}
          {progress && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <IconLoader2 size={13} className="animate-spin" />
              {progress}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={!!busy}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!!busy || rows.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? <IconLoader2 size={13} className="animate-spin" /> : <IconDownload size={13} />}
            {enrichFirst && creditCost > 0
              ? `Enrich ${enrichable} and export · ${creditCost} credits`
              : `Export ${rows.length.toLocaleString()} ${rows.length === 1 ? "record" : "records"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
