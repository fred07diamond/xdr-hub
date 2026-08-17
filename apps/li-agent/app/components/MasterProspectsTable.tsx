import { callAction, useActionQuery } from "@agent-native/core/client";
import { IconBrandLinkedin, IconDownload, IconExternalLink, IconLoader2, IconUsers } from "@tabler/icons-react";
import { useState } from "react";

import { Pagination } from "@/components/Pagination";

type EnrichmentStatus = "idle" | "enriching" | "done" | "not_found" | "failed";

interface MasterRow {
  id: string;
  source: "prospect" | "lead_list";
  name: string | null;
  headline: string | null;
  role: string | null;
  company: string | null;
  location: string | null;
  profileUrl: string | null;
  salesNavLeadUrl: string | null;
  listName: string | null;
  fitVerdict: "strong" | "possible" | "weak" | "inconclusive" | null;
  status: string | null;
  personaName: string | null;
  personaColor: string | null;
  enrichmentStatus: EnrichmentStatus;
  enrichedEmail: string | null;
  enrichedTitle: string | null;
  enrichedPhone: string | null;
  enrichedLinkedinUrl: string | null;
  createdAt: string | null;
}

const MASTER_PAGE_SIZE = 25;
const EXPORT_FETCH_LIMIT = 5000;

function linkedInUrl(row: MasterRow): string {
  if (row.profileUrl) return row.profileUrl;
  if (row.enrichedLinkedinUrl) return row.enrichedLinkedinUrl;
  if (row.salesNavLeadUrl) return row.salesNavLeadUrl;
  const parts = [row.name, row.company].filter(Boolean);
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(parts.join(" "))}`;
}

function EnrichedField({ value, status }: { value: string | null; status: EnrichmentStatus }) {
  if (value) return <span className="text-xs truncate max-w-[170px] block">{value}</span>;
  if (status === "not_found") return <span className="text-xs italic text-muted-foreground/70">Not found</span>;
  if (status === "failed") return <span className="text-xs italic text-destructive/70">Failed</span>;
  if (status === "done") return <span className="text-xs italic text-muted-foreground/70">—</span>;
  return <span className="text-xs text-muted-foreground/50">—</span>;
}

function SourceBadge({ row }: { row: MasterRow }) {
  if (row.source === "prospect") {
    return (
      <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
        Prospect
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground truncate max-w-[120px]">
      {row.listName ?? "Lead list"}
    </span>
  );
}

function csvEscape(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function splitName(name: string | null): { first: string; last: string } {
  if (!name) return { first: "", last: "" };
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

// Same column shape as the extension's per-list Apollo CSV export
// (buildApolloCsv in extension/panel.js), so a rep gets one consistent
// format whether exporting a single list or everything at once.
function buildMasterCsv(rows: MasterRow[]): string {
  const header = ["First Name", "Last Name", "Company", "Title", "Email", "Phone", "LinkedIn Url", "Location"];
  const body = rows.map((row) => {
    const { first, last } = splitName(row.name);
    return [
      first,
      last,
      row.company || "",
      row.enrichedTitle || row.headline || "",
      row.enrichedEmail || "",
      row.enrichedPhone || "",
      row.enrichedLinkedinUrl || row.profileUrl || row.salesNavLeadUrl || "",
      row.location || "",
    ].map(csvEscape).join(",");
  });
  return [header.join(","), ...body].join("\r\n");
}

export function MasterProspectsTable() {
  const [page, setPage] = useState(1);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const { data, isLoading } = useActionQuery(
    "list-all-prospects",
    { limit: MASTER_PAGE_SIZE, offset: (page - 1) * MASTER_PAGE_SIZE },
    { refetchInterval: 30_000 },
  );

  const rows: MasterRow[] = (data as { rows?: MasterRow[] } | undefined)?.rows ?? [];
  const totalCount: number = (data as { totalCount?: number } | undefined)?.totalCount ?? 0;

  async function handleExportAll() {
    setIsExporting(true);
    setExportError(null);
    try {
      const result = await callAction(
        "list-all-prospects",
        { limit: EXPORT_FETCH_LIMIT, offset: 0 },
        { method: "GET" },
      );
      const allRows: MasterRow[] = (result as { rows?: MasterRow[] } | undefined)?.rows ?? [];
      if (allRows.length === 0) {
        setExportError("Nothing to export yet.");
        return;
      }
      const csv = buildMasterCsv(allRows);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `all-prospects-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError("Could not export -- try again.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div>
          <h2 className="text-sm font-semibold">All Prospects</h2>
          <p className="text-xs text-muted-foreground">
            {isLoading ? "Loading…" : `${totalCount.toLocaleString()} prospect${totalCount === 1 ? "" : "s"}, combined and deduped`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {exportError && <span className="text-xs text-destructive">{exportError}</span>}
          <button
            type="button"
            onClick={handleExportAll}
            disabled={isExporting || totalCount === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {isExporting ? <IconLoader2 size={12} className="animate-spin" /> : <IconDownload size={12} />}
            Export CSV
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center gap-2 px-6 py-8 text-sm text-muted-foreground">
            <IconLoader2 size={14} className="animate-spin" />
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-center">
            <IconUsers size={32} className="text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Nothing captured yet.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Title</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Company</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Email</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Phone</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Source</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">LinkedIn</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-b-0 transition-colors hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium">{row.name ?? "—"}</p>
                      {row.personaName && row.personaColor && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shrink-0">
                          <span style={{ background: row.personaColor }} className="inline-block h-1.5 w-1.5 rounded-full" />
                          {row.personaName}
                        </span>
                      )}
                    </div>
                    {row.location && <p className="text-[11px] text-muted-foreground truncate max-w-[180px]">{row.location}</p>}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{row.enrichedTitle || row.headline || "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{row.company ?? "—"}</td>
                  <td className="px-4 py-3">
                    <EnrichedField value={row.enrichedEmail} status={row.enrichmentStatus} />
                  </td>
                  <td className="px-4 py-3">
                    <EnrichedField value={row.enrichedPhone} status={row.enrichmentStatus} />
                  </td>
                  <td className="px-4 py-3">
                    <SourceBadge row={row} />
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={linkedInUrl(row)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted"
                    >
                      <IconBrandLinkedin size={11} className="text-[#0077B5]" />
                      Open
                      <IconExternalLink size={9} />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalCount > 0 && (
        <div className="flex items-center justify-end border-t border-border px-4 py-2">
          <Pagination page={page} pageSize={MASTER_PAGE_SIZE} totalCount={totalCount} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
