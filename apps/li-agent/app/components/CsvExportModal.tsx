import { IconCheck, IconDownload, IconLoader2, IconX } from "@tabler/icons-react";
import { useMemo, useState } from "react";

import { useCreditUsage, type CreditUsage } from "@/components/ApolloCreditGauge";
import { useApolloEnrichment } from "@/lib/apollo-enrichment";
import {
  CREDITS_PER_EMAIL,
  CREDITS_PER_PHONE_REVEAL,
  MAX_BULK_ENRICH,
} from "@/lib/apollo-limits";
import { buildMasterCsv, CSV_HEADER, csvRowCells, type CsvRow } from "@/lib/prospects-csv";
import { describeBar, verdictClearsBar } from "@/lib/verdict-bar";

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
/** Extra fields the batch decisions read, present on both row types. */
export interface ExportableRow extends CsvRow {
  fitVerdict?: string | null;
  phoneRevealStatus?: string | null;
}

export interface CsvExportModalProps<T extends ExportableRow> {
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
  /**
   * Reveals phone numbers for the given rows and resolves with the updated
   * set. Omit to hide the phone toggle.
   */
  onRevealPhones?: (rows: T[]) => Promise<T[]>;
  title?: string;
}

const PREVIEW_ROWS = 5;

export function CsvExportModal<T extends ExportableRow>({
  open,
  onClose,
  rows,
  filenamePrefix,
  onEnrich,
  onRevealPhones,
  title = "Export CSV",
}: CsvExportModalProps<T>) {
  const apollo = useApolloEnrichment();
  const { data: usageRaw } = useCreditUsage();
  const usage = usageRaw as CreditUsage | undefined;

  const [enrichEmails, setEnrichEmails] = useState(false);
  const [revealPhones, setRevealPhones] = useState(false);
  const [busy, setBusy] = useState<null | "enriching" | "writing">(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const phoneBar = usage?.phoneMinVerdict ?? "strong";
  const phonesPaused = (usage?.spentPct ?? 0) >= (usage?.phoneStopPct ?? 100);

  const missingEmail = useMemo(() => rows.filter((r) => !r.enrichedEmail), [rows]);

  /**
   * Rows that could get a phone, split by whether they clear the fit bar.
   *
   * The bar still applies in bulk. A per-lead reveal can be overridden with a
   * deliberate two-step confirmation; a batch cannot -- 50 leads is 400
   * credits and there is no checkbox that makes that considered. So low-fit
   * leads are COUNTED AND NAMED here rather than silently dropped, and reveal
   * them one at a time if you really want them.
   */
  const phoneCandidates = useMemo(
    () =>
      rows.filter(
        (r) =>
          !r.enrichedPhone &&
          // Already asked and answered: re-asking buys the same nothing.
          r.phoneRevealStatus !== "requested" &&
          r.phoneRevealStatus !== "no_match",
      ),
    [rows],
  );
  const phoneEligible = useMemo(
    () => phoneCandidates.filter((r) => verdictClearsBar(r.fitVerdict, phoneBar)),
    [phoneCandidates, phoneBar],
  );
  const phoneSkipped = phoneCandidates.length - phoneEligible.length;

  // The batch cap applies here too. Without it, "export 400 leads and enrich
  // the missing ones" would be a single click authorizing 400 Apollo calls.
  const emailCount = Math.min(missingEmail.length, MAX_BULK_ENRICH);
  const phoneCount = Math.min(phoneEligible.length, MAX_BULK_ENRICH);

  const emailCredits = enrichEmails ? emailCount * CREDITS_PER_EMAIL : 0;
  const phoneCredits = revealPhones ? phoneCount * CREDITS_PER_PHONE_REVEAL : 0;
  const creditCost = emailCredits + phoneCredits;

  const remaining = usage?.remaining ?? null;
  const personalRemaining = usage?.mine?.remaining ?? null;
  // Fail closed in the display: if either ceiling cannot cover it, say so
  // rather than letting the run stop halfway.
  const overWorkspace = remaining != null && creditCost > remaining;
  const overPersonal = personalRemaining != null && creditCost > personalRemaining;
  const overBudget = overWorkspace || overPersonal;

  const canEnrichEmails = !!onEnrich && apollo.enabled && emailCount > 0;
  const canRevealPhones = !!onRevealPhones && apollo.enabled && phoneCount > 0 && !phonesPaused;

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

    // Emails first, then phones. Order matters: a match can surface a phone
    // synchronously, so enriching first means some reveals turn out to be
    // unnecessary and those 8 credits are never spent.
    if (enrichEmails && onEnrich && canEnrichEmails) {
      setBusy("enriching");
      setProgress(`Finding ${emailCount} ${emailCount === 1 ? "email" : "emails"}…`);
      try {
        finalRows = await onEnrich(missingEmail.slice(0, MAX_BULK_ENRICH));
      } catch (err) {
        return failRun(err, "Enrichment");
      }
    }

    if (revealPhones && onRevealPhones && canRevealPhones) {
      setBusy("enriching");
      setProgress(`Revealing ${phoneCount} phone ${phoneCount === 1 ? "number" : "numbers"}…`);
      try {
        // Re-derive from the post-enrichment rows: anything that just picked
        // up a phone no longer needs an 8-credit reveal.
        const stillMissing = finalRows.filter(
          (r) =>
            !r.enrichedPhone &&
            r.phoneRevealStatus !== "requested" &&
            r.phoneRevealStatus !== "no_match" &&
            verdictClearsBar(r.fitVerdict, phoneBar),
        );
        if (stillMissing.length > 0) {
          finalRows = await onRevealPhones(stillMissing.slice(0, MAX_BULK_ENRICH));
        }
      } catch (err) {
        return failRun(err, "Phone reveal");
      }
    }

    setBusy("writing");
    setProgress(null);
    download(finalRows);
    setBusy(null);
    onClose();
  }

  /**
   * Aborts without downloading.
   *
   * Deliberately does NOT fall through to the file: someone who asked for an
   * enriched export must not silently receive the unenriched one, because they
   * would send it and never know.
   */
  function failRun(err: unknown, what: string) {
    setError(
      err instanceof Error
        ? `${what} failed: ${err.message} Nothing was exported — turn the toggles off to export what you already have.`
        : `${what} failed. Nothing was exported.`,
    );
    setBusy(null);
    setProgress(null);
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
          {/* Left: what is in the file. Right: the Summary panel, laid out
              the way Apollo's own import dialog does it -- record count on
              top, a toggle per enrichment with its record count, then the
              credit total under a divider. Two columns because the summary is
              a decision surface and should not be buried under the table. */}
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_260px]">
            <div className="space-y-2 text-xs text-muted-foreground">
              {rows.length > PREVIEW_ROWS && (
                <p>
                  Showing {PREVIEW_ROWS} of{" "}
                  <span className="font-medium text-foreground">{rows.length.toLocaleString()}</span> rows.
                </p>
              )}
              <p className="leading-4">
                Apollo only charges when it actually has the data, so records it cannot find cost nothing.
              </p>
              {phoneSkipped > 0 && (
                <p className="leading-4">
                  {phoneSkipped.toLocaleString()} {phoneSkipped === 1 ? "lead is" : "leads are"} missing a phone
                  but {phoneSkipped === 1 ? "does" : "do"} not clear the{" "}
                  <span className="text-foreground">{describeBar(phoneBar)}</span> bar, so{" "}
                  {phoneSkipped === 1 ? "it is" : "they are"} not included above. Reveal those individually if
                  you want them — at 8 credits each, a batch is not the place to override the bar.
                </p>
              )}
              {phonesPaused && (
                <p className="leading-4 text-amber-600 dark:text-amber-400">
                  Phone reveals are paused workspace-wide past {usage?.phoneStopPct}% of the budget. Emails
                  still work.
                </p>
              )}
            </div>

            <div className="rounded-lg border border-border p-3">
              <p className="text-xs font-medium text-foreground">Summary</p>

              <div className="mt-2 rounded-md bg-muted/50 py-3 text-center">
                <p className="text-2xl font-semibold tabular-nums text-foreground">
                  {rows.length.toLocaleString()}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {rows.length === 1 ? "record to export" : "records to export"}
                </p>
              </div>

              <div className="mt-3 space-y-2.5">
                <ToggleRow
                  on={enrichEmails}
                  disabled={!canEnrichEmails || !!busy}
                  onChange={setEnrichEmails}
                  label="Enrich emails"
                  count={emailCount}
                  detail={
                    missingEmail.length === 0
                      ? "every record already has one"
                      : !apollo.enabled
                        ? "enrichment is off"
                        : `1 credit each${missingEmail.length > MAX_BULK_ENRICH ? ` · capped at ${MAX_BULK_ENRICH}` : ""}`
                  }
                />
                <ToggleRow
                  on={revealPhones}
                  disabled={!canRevealPhones || !!busy}
                  onChange={setRevealPhones}
                  label="Enrich phone numbers"
                  count={phoneCount}
                  detail={
                    phonesPaused
                      ? "paused workspace-wide"
                      : phoneCandidates.length === 0
                        ? "every record already has one"
                        : phoneEligible.length === 0
                          ? `none clear the ${describeBar(phoneBar)} bar`
                          : `8 credits each${phoneSkipped > 0 ? ` · ${phoneSkipped} below the fit bar` : ""}`
                  }
                />
              </div>

              <div className="mt-3 border-t border-dashed border-border pt-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-foreground">Credit total</span>
                  <span
                    className={`text-sm font-semibold tabular-nums ${overBudget ? "text-destructive" : "text-foreground"}`}
                  >
                    {creditCost.toLocaleString()}
                  </span>
                </div>
                {creditCost > 0 && (
                  <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                    {emailCredits > 0 && <>{emailCount} × 1 for emails</>}
                    {emailCredits > 0 && phoneCredits > 0 && " · "}
                    {phoneCredits > 0 && <>{phoneCount} × 8 for phones</>}
                  </p>
                )}
                {remaining != null && (
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                    {remaining.toLocaleString()} credits left this period
                    {personalRemaining != null && <> · {personalRemaining.toLocaleString()} of yours</>}
                  </p>
                )}
                {overWorkspace && (
                  <p className="mt-1 text-[11px] leading-4 text-destructive">
                    More than the workspace has left.
                  </p>
                )}
                {!overWorkspace && overPersonal && (
                  <p className="mt-1 text-[11px] leading-4 text-destructive">
                    More than your own allowance has left.
                  </p>
                )}
              </div>
            </div>
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
            disabled={!!busy || rows.length === 0 || overBudget}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? <IconLoader2 size={13} className="animate-spin" /> : <IconDownload size={13} />}
            {creditCost > 0
              ? `Enrich and export · ${creditCost.toLocaleString()} credits`
              : `Export ${rows.length.toLocaleString()} ${rows.length === 1 ? "record" : "records"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Apollo-style pill switch with a trailing record count.
 *
 * A switch rather than a checkbox because each one authorises spending, and a
 * switch reads as a mode being turned on rather than a box incidentally
 * ticked. Disabled state still shows its count and reason, so "0" is
 * explained rather than just unavailable.
 */
function ToggleRow({
  on,
  disabled,
  onChange,
  label,
  count,
  detail,
}: {
  on: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  label: string;
  count: number;
  detail: string;
}) {
  return (
    <div className={`flex items-start gap-2.5 ${disabled ? "opacity-60" : ""}`}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={`mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
          on ? "bg-foreground" : "bg-muted-foreground/30"
        } ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
      >
        <span
          className={`h-3 w-3 rounded-full bg-background transition-transform ${on ? "translate-x-3.5" : "translate-x-0.5"}`}
        />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-foreground">{label}</span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{count}</span>
        </div>
        <p className="text-[11px] leading-4 text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}
