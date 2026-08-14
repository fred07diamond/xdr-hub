import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import {
  IconBrandLinkedin,
  IconCheck,
  IconClipboard,
  IconExternalLink,
  IconLoader2,
  IconRefresh,
  IconSearch,
  IconSparkles,
  IconThumbDown,
  IconThumbUp,
  IconTrash,
  IconX,
} from "@tabler/icons-react";

function HubSpotIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#ff7a59" />
      <text x="16" y="21" textAnchor="middle" fill="white" fontSize="16" fontWeight="700" fontFamily="sans-serif">H</text>
    </svg>
  );
}
import { useEffect, useMemo, useRef, useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { APP_TITLE } from "@/lib/app-config";
import { cn } from "@/lib/utils";

export function meta() {
  return [
    { title: `${APP_TITLE} — Prospects` },
    { name: "description", content: "Track your LinkedIn outreach prospects." },
  ];
}

type Verdict = "strong" | "possible" | "weak" | null;
type Status = "captured" | "drafted" | "sent";

interface Prospect {
  id: string;
  profileUrl: string;
  name: string | null;
  headline: string | null;
  role: string | null;
  company: string | null;
  fitVerdict: Verdict;
  fitReason: string | null;
  draftNote: string | null;
  draftFollowUp: string | null;
  personaName: string | null;
  personaColor: string | null;
  rating: number | null;
  ratingNote: string | null;
  status: Status;
  enrichmentStatus: "idle" | "enriching" | "done" | "not_found" | "failed";
  enrichedEmail: string | null;
  enrichedTitle: string | null;
  enrichedPhone: string | null;
  enrichedLinkedinUrl: string | null;
  enrichedCompanyIndustry: string | null;
  enrichedCompanySize: number | null;
  enrichmentError: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

const VERDICT_STYLES: Record<NonNullable<Verdict>, string> = {
  strong: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  possible: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  weak: "bg-rose-500/15 text-rose-500 dark:text-rose-400",
};

const STATUS_STYLES: Record<Status, string> = {
  captured: "bg-muted text-muted-foreground",
  drafted: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  sent: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
};

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  if (!verdict) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${VERDICT_STYLES[verdict]}`}>
      {verdict}
    </span>
  );
}

function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

function EnrichedField({
  value,
  status,
  kind,
}: {
  value: string | null;
  status: Prospect["enrichmentStatus"];
  kind: "email" | "phone";
}) {
  if (value) return <span className="text-xs truncate max-w-[170px] block">{value}</span>;
  if (status === "not_found") {
    return <span className="text-xs italic text-muted-foreground/70">No contact info found</span>;
  }
  if (status === "failed") {
    return <span className="text-xs italic text-destructive/70">Enrichment failed</span>;
  }
  if (status === "done") {
    return <span className="text-xs italic text-muted-foreground/70">No {kind} found</span>;
  }
  return <span className="text-xs text-muted-foreground/50">—</span>;
}

function EnrichButton({
  prospect,
  isEnriching,
  onEnrich,
}: {
  prospect: Prospect;
  isEnriching: boolean;
  onEnrich: (prospect: Prospect) => void;
}) {
  if (isEnriching || prospect.enrichmentStatus === "enriching") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <IconLoader2 size={11} className="animate-spin" />
        Enriching…
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onEnrich(prospect); }}
      title={prospect.enrichmentError ?? undefined}
      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted"
    >
      <IconSparkles size={11} />
      {prospect.enrichmentStatus === "done"
        ? "Re-enrich"
        : prospect.enrichmentStatus === "failed" || prospect.enrichmentStatus === "not_found"
        ? "Retry enrich"
        : "Enrich"}
    </button>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {copied ? <IconCheck size={13} /> : <IconClipboard size={13} />}
      {copied ? "Copied" : label}
    </button>
  );
}

// ── Filter pill ───────────────────────────────────────────────────────────────

function FilterPill({
  active,
  onClick,
  children,
  color,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={active && color ? { background: color + "22", borderColor: color, color } : {}}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
        active && !color
          ? "border-foreground/30 bg-foreground/10 text-foreground"
          : !active
          ? "border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground"
          : ""
      }`}
    >
      {children}
    </button>
  );
}

// ── Detail slide-over ────────────────────────────────────────────────────────

function ProspectSheet({
  prospect,
  onClose,
  onUpdated,
  onDeleted,
}: {
  prospect: Prospect;
  onClose: () => void;
  onUpdated: () => void;
  onDeleted: () => void;
}) {
  const markSent = useActionMutation("mark-sent");
  const updateNote = useActionMutation("update-prospect-note");
  const deleteProspect = useActionMutation("delete-prospect");
  const rateProspect = useActionMutation("rate-prospect");
  const redraft = useActionMutation("redraft-prospect");
  const enrichProspect = useActionMutation("enrich-prospect");
  const [isEnriching, setIsEnriching] = useState(false);

  const crmQuery = useActionQuery(
    "check-hubspot-contact",
    { profileUrl: prospect.profileUrl },
    { enabled: true },
  );
  const crm = crmQuery.data as
    | {
        connected: boolean;
        found: boolean;
        contactId?: string;
        hubspotUrl?: string | null;
        contact?: { lifecycleStage: string; leadStatus: string };
        deals?: Array<{ name: string; stage: string }>;
      }
    | undefined;

  const [note, setNote] = useState(prospect.draftNote ?? "");
  const [followUp, setFollowUp] = useState(prospect.draftFollowUp ?? "");
  const [noteDirty, setNoteDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rating, setRating] = useState<number | null>(prospect.rating ?? null);
  const [ratingNote, setRatingNote] = useState(prospect.ratingNote ?? "");
  const [showRatingNote, setShowRatingNote] = useState(false);

  useEffect(() => {
    if (!noteDirty) {
      setNote(prospect.draftNote ?? "");
      setFollowUp(prospect.draftFollowUp ?? "");
    }
  }, [prospect.draftNote, prospect.draftFollowUp, prospect.updatedAt]);

  async function handleSaveNote() {
    await updateNote.mutateAsync({ id: prospect.id, draftNote: note, draftFollowUp: followUp || null });
    setNoteDirty(false);
    onUpdated();
  }

  async function handleMarkSent() {
    await markSent.mutateAsync({ profileUrl: prospect.profileUrl });
    onUpdated();
  }

  async function handleRedraft() {
    const result = await redraft.mutateAsync({ id: prospect.id });
    if (result?.draft) {
      setNote(result.draft.draftNote ?? "");
      setFollowUp(result.draft.draftFollowUp ?? "");
      setNoteDirty(false);
    }
    onUpdated();
  }

  async function handleRate(value: 1 | -1) {
    const newRating = rating === value ? null : value;
    const note = newRating === -1 ? ratingNote : null;
    await rateProspect.mutateAsync({ id: prospect.id, rating: newRating ?? value, ratingNote: note });
    setRating(newRating);
    if (newRating === -1) setShowRatingNote(true);
    else setShowRatingNote(false);
    onUpdated();
  }

  async function handleRatingNoteBlur() {
    if (rating === -1 && ratingNote.trim()) {
      await rateProspect.mutateAsync({ id: prospect.id, rating: -1, ratingNote: ratingNote.trim() });
      onUpdated();
    }
  }

  async function handleDelete() {
    await deleteProspect.mutateAsync({ id: prospect.id });
    onClose();
    onDeleted();
  }

  async function handleEnrichFromSheet() {
    setIsEnriching(true);
    try {
      await enrichProspect.mutateAsync({ id: prospect.id });
    } finally {
      setIsEnriching(false);
      onUpdated();
    }
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent showClose={false} className="flex w-full flex-col gap-0 p-0 sm:max-w-lg overflow-hidden">
        <SheetHeader className="border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="flex items-center gap-1.5 text-sm font-semibold">
                <a href={prospect.profileUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 hover:text-primary hover:underline">
                  <IconBrandLinkedin size={15} className="shrink-0 text-[#0077B5]" />
                  {prospect.name ?? prospect.profileUrl}
                </a>
              </SheetTitle>
              {(prospect.role || prospect.company) && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {[prospect.role, prospect.company].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
            <button type="button" onClick={onClose} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted">
              <IconX size={16} />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <VerdictBadge verdict={prospect.fitVerdict} />
            <StatusBadge status={prospect.status} />
            {prospect.personaName && prospect.personaColor && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                <span style={{ background: prospect.personaColor }} className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" />
                {prospect.personaName}
              </span>
            )}
            {crm?.connected && crm.found && (
              crm.hubspotUrl ? (
                <a
                  href={crm.hubspotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium no-underline"
                  style={{ background: "rgba(255,122,89,0.15)", color: "#ff7a59" }}
                >
                  <HubSpotIcon />
                  HubSpot
                  <IconExternalLink size={9} />
                </a>
              ) : (
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{ background: "rgba(255,122,89,0.15)", color: "#ff7a59" }}
                >
                  <HubSpotIcon />
                  HubSpot
                </span>
              )
            )}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {prospect.fitReason && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Fit rationale</p>
              <p className="text-sm text-foreground leading-relaxed">{prospect.fitReason}</p>
            </div>
          )}
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Connection note</p>
            <textarea value={note} onChange={(e) => { setNote(e.target.value); setNoteDirty(true); }} rows={6}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring" />
            <div className="mt-1 flex items-center justify-between">
              <span className={`text-xs ${note.length > 300 ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                {note.length} / 300 chars
              </span>
              <CopyButton text={note} />
            </div>
          </div>
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Follow-up (after they accept)</p>
            <textarea value={followUp} onChange={(e) => { setFollowUp(e.target.value); setNoteDirty(true); }} rows={3}
              placeholder="No follow-up drafted"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50" />
            {followUp && <div className="mt-1 flex justify-end"><CopyButton text={followUp} label="Copy follow-up" /></div>}
          </div>

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Was this note helpful?</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => handleRate(1)} disabled={rateProspect.isPending}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${rating === 1 ? "border-emerald-400 bg-emerald-500/10 text-emerald-600" : "border-border hover:bg-muted text-muted-foreground"}`}>
                <IconThumbUp size={13} />
                Helpful
              </button>
              <button type="button" onClick={() => { handleRate(-1); setShowRatingNote(true); }} disabled={rateProspect.isPending}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${rating === -1 ? "border-rose-400 bg-rose-500/10 text-rose-500" : "border-border hover:bg-muted text-muted-foreground"}`}>
                <IconThumbDown size={13} />
                Not helpful
              </button>
            </div>
            {(showRatingNote || rating === -1) && (
              <input
                type="text"
                value={ratingNote}
                onChange={(e) => setRatingNote(e.target.value)}
                onBlur={handleRatingNoteBlur}
                placeholder="What was off? (optional)"
                className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
              />
            )}
          </div>

          <div className="pt-4 border-t border-border">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Apollo enrichment</p>
              {!isEnriching && prospect.enrichmentStatus !== "enriching" && (
                <button type="button" onClick={handleEnrichFromSheet}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted">
                  <IconSparkles size={11} />
                  {prospect.enrichmentStatus === "done"
                    ? "Re-enrich"
                    : prospect.enrichmentStatus === "failed" || prospect.enrichmentStatus === "not_found"
                    ? "Retry enrich"
                    : "Enrich"}
                </button>
              )}
            </div>
            {isEnriching || prospect.enrichmentStatus === "enriching" ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <IconLoader2 size={12} className="animate-spin" />
                Enriching…
              </p>
            ) : prospect.enrichmentStatus === "not_found" ? (
              <p className="text-xs italic text-muted-foreground">No Apollo match found for this person.</p>
            ) : prospect.enrichmentStatus === "failed" ? (
              <p className="text-xs italic text-destructive" title={prospect.enrichmentError ?? undefined}>
                Enrichment failed{prospect.enrichmentError ? `: ${prospect.enrichmentError}` : "."}
              </p>
            ) : prospect.enrichmentStatus === "done" ? (
              <div className="overflow-hidden rounded-lg border border-border divide-y divide-border bg-muted/20">
                {[
                  { label: "Title", value: prospect.enrichedTitle },
                  { label: "Email", value: prospect.enrichedEmail },
                  { label: "Phone", value: prospect.enrichedPhone },
                  { label: "Industry", value: prospect.enrichedCompanyIndustry },
                  {
                    label: "Company size",
                    value: prospect.enrichedCompanySize ? `~${prospect.enrichedCompanySize.toLocaleString()} employees` : null,
                  },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="shrink-0 text-[11px] text-muted-foreground">{row.label}</span>
                    <span className={cn("truncate text-xs text-right", row.value ? "text-foreground" : "text-muted-foreground/60")}>
                      {row.value ?? "—"}
                    </span>
                  </div>
                ))}
                {prospect.enrichedLinkedinUrl && (
                  <div className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="shrink-0 text-[11px] text-muted-foreground">Apollo LinkedIn match</span>
                    <a href={prospect.enrichedLinkedinUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                      View profile <IconExternalLink size={10} />
                    </a>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Not enriched yet.</p>
            )}
          </div>
        </div>

        <div className="border-t border-border px-5 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {noteDirty ? (
              <button type="button" onClick={handleSaveNote} disabled={updateNote.isPending}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {updateNote.isPending && <IconLoader2 size={12} className="animate-spin" />}
                Save changes
              </button>
            ) : prospect.status !== "sent" ? (
              <button type="button" onClick={handleMarkSent} disabled={markSent.isPending}
                className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50">
                {markSent.isPending ? <IconLoader2 size={12} className="animate-spin" /> : <IconCheck size={13} />}
                Mark sent
              </button>
            ) : null}
            <button type="button" onClick={handleRedraft} disabled={redraft.isPending}
              title="Regenerate note"
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50">
              {redraft.isPending ? <IconLoader2 size={12} className="animate-spin" /> : <IconRefresh size={13} />}
              Re-draft
            </button>
          </div>
          <div>
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Delete this prospect?</span>
                <button type="button" onClick={handleDelete} disabled={deleteProspect.isPending}
                  className="rounded px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50">
                  {deleteProspect.isPending ? "Deleting…" : "Yes, delete"}
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="rounded p-1 text-muted-foreground hover:bg-muted">
                  <IconX size={13} />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)}
                className="rounded p-1.5 text-muted-foreground/50 hover:bg-muted hover:text-destructive transition-colors" title="Delete">
                <IconTrash size={15} />
              </button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Route ────────────────────────────────────────────────────────────────────

export default function ProspectsRoute() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirmDelete, setBulkConfirmDelete] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [verdictFilter, setVerdictFilter] = useState<NonNullable<Verdict> | "all">("all");
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [personaFilter, setPersonaFilter] = useState<string>("all");

  const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set());
  const [bulkEnrichProgress, setBulkEnrichProgress] = useState<{ done: number; total: number } | null>(null);

  const bulkDeleteProspects = useActionMutation("bulk-delete-prospects");
  const deleteProspect = useActionMutation("delete-prospect");
  const markSent = useActionMutation("mark-sent");
  const enrichProspect = useActionMutation("enrich-prospect");

  const { data, refetch, isLoading } = useActionQuery("list-prospects", {}, {
    refetchInterval: (query) => {
      const rows = (query.state.data as any)?.prospects as any[] | undefined;
      return rows?.some((p) => p.status === "captured") ? 5000 : 30000;
    },
    refetchIntervalInBackground: false,
    staleTime: 4000,
  });

  const allProspects: Prospect[] = (data as any)?.prospects ?? [];

  // Derived persona list for filter chips
  const personas = useMemo(() => [...new Map(
    allProspects
      .filter((p) => p.personaName && p.personaColor)
      .map((p) => [p.personaName!, { name: p.personaName!, color: p.personaColor! }])
  ).values()], [allProspects]);

  // Apply filters
  const filtered = useMemo(() => allProspects.filter((p) => {
    if (verdictFilter !== "all" && p.fitVerdict !== verdictFilter) return false;
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    if (personaFilter !== "all" && p.personaName !== personaFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const haystack = [p.name, p.company, p.role, p.headline].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  }), [allProspects, verdictFilter, statusFilter, personaFilter, search]);

  const selected = allProspects.find((p) => p.id === selectedId) ?? null;
  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id));
  const someSelected = selectedIds.size > 0;

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filtered.forEach((p) => next.delete(p.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filtered.forEach((p) => next.add(p.id));
        return next;
      });
    }
  }

  async function handleBulkDelete() {
    await bulkDeleteProspects.mutateAsync({ ids: Array.from(selectedIds) });
    setSelectedIds(new Set());
    setBulkConfirmDelete(false);
    refetch();
  }

  async function handleBulkMarkSent() {
    const toMark = allProspects.filter((p) => selectedIds.has(p.id) && p.status !== "sent");
    for (const p of toMark) {
      await markSent.mutateAsync({ profileUrl: p.profileUrl });
    }
    setSelectedIds(new Set());
    refetch();
  }

  async function handleEnrich(prospect: Prospect) {
    setEnrichingIds((prev) => new Set(prev).add(prospect.id));
    try {
      await enrichProspect.mutateAsync({ id: prospect.id });
    } finally {
      setEnrichingIds((prev) => {
        const next = new Set(prev);
        next.delete(prospect.id);
        return next;
      });
      refetch();
    }
  }

  // Sequential, not parallel -- keeps this well under the per-hour Apollo
  // rate limit and avoids hammering Apollo with a burst of concurrent calls.
  async function handleBulkEnrich() {
    const targets = allProspects.filter((p) => selectedIds.has(p.id));
    if (targets.length === 0) return;
    setBulkEnrichProgress({ done: 0, total: targets.length });
    for (const p of targets) {
      setEnrichingIds((prev) => new Set(prev).add(p.id));
      try {
        await enrichProspect.mutateAsync({ id: p.id });
      } catch {
        // Per-item failures are surfaced via enrichmentError on that row --
        // keep going so one bad prospect doesn't stop the rest of the batch.
      } finally {
        setEnrichingIds((prev) => {
          const next = new Set(prev);
          next.delete(p.id);
          return next;
        });
        setBulkEnrichProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
      }
    }
    setBulkEnrichProgress(null);
    setSelectedIds(new Set());
    refetch();
  }

  const hasActiveFilter = verdictFilter !== "all" || statusFilter !== "all" || personaFilter !== "all" || search;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3 min-h-[52px]">
        {someSelected ? (
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-foreground">{selectedIds.size} selected</span>
            <button type="button" onClick={() => setSelectedIds(new Set())}
              className="text-xs text-muted-foreground hover:text-foreground">Deselect all</button>
            <div className="h-4 w-px bg-border" />
            {bulkConfirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Delete {selectedIds.size} prospects?</span>
                <button type="button" onClick={handleBulkDelete} disabled={bulkDeleteProspects.isPending}
                  className="rounded px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50">
                  {bulkDeleteProspects.isPending ? "Deleting…" : "Confirm"}
                </button>
                <button type="button" onClick={() => setBulkConfirmDelete(false)} className="rounded p-1 text-muted-foreground hover:bg-muted">
                  <IconX size={13} />
                </button>
              </div>
            ) : (
              <>
                <button type="button" onClick={() => setBulkConfirmDelete(true)}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10">
                  <IconTrash size={13} /> Delete
                </button>
                <button type="button" onClick={handleBulkMarkSent} disabled={markSent.isPending}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">
                  <IconCheck size={13} /> Mark sent
                </button>
                {bulkEnrichProgress ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <IconLoader2 size={12} className="animate-spin" />
                    Enriching {bulkEnrichProgress.done}/{bulkEnrichProgress.total}…
                  </span>
                ) : (
                  <button type="button" onClick={handleBulkEnrich}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">
                    <IconSparkles size={13} /> Enrich selected
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <div>
            <h1 className="text-sm font-semibold text-foreground">Prospects</h1>
            <p className="text-xs text-muted-foreground">
              {isLoading ? "Loading…" : hasActiveFilter
                ? `${filtered.length} of ${allProspects.length} prospects`
                : `${allProspects.length} prospect${allProspects.length === 1 ? "" : "s"}`}
            </p>
          </div>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        {/* Search */}
        <div className="relative">
          <IconSearch size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or company…"
            className="h-7 rounded-md border border-border bg-muted/40 pl-7 pr-3 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring w-44"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <IconX size={11} />
            </button>
          )}
        </div>

        <div className="h-4 w-px bg-border" />

        {/* Verdict */}
        <div className="flex items-center gap-1">
          <FilterPill active={verdictFilter === "all"} onClick={() => setVerdictFilter("all")}>All fits</FilterPill>
          <FilterPill active={verdictFilter === "strong"} onClick={() => setVerdictFilter(verdictFilter === "strong" ? "all" : "strong")}>Strong</FilterPill>
          <FilterPill active={verdictFilter === "possible"} onClick={() => setVerdictFilter(verdictFilter === "possible" ? "all" : "possible")}>Possible</FilterPill>
          <FilterPill active={verdictFilter === "weak"} onClick={() => setVerdictFilter(verdictFilter === "weak" ? "all" : "weak")}>Weak</FilterPill>
        </div>

        <div className="h-4 w-px bg-border" />

        {/* Status */}
        <div className="flex items-center gap-1">
          <FilterPill active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>All statuses</FilterPill>
          <FilterPill active={statusFilter === "drafted"} onClick={() => setStatusFilter(statusFilter === "drafted" ? "all" : "drafted")}>Drafted</FilterPill>
          <FilterPill active={statusFilter === "sent"} onClick={() => setStatusFilter(statusFilter === "sent" ? "all" : "sent")}>Sent</FilterPill>
        </div>

        {/* Persona */}
        {personas.length > 1 && (
          <>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-1">
              <FilterPill active={personaFilter === "all"} onClick={() => setPersonaFilter("all")}>All personas</FilterPill>
              {personas.map((persona) => (
                <FilterPill
                  key={persona.name}
                  active={personaFilter === persona.name}
                  color={persona.color}
                  onClick={() => setPersonaFilter(personaFilter === persona.name ? "all" : persona.name)}
                >
                  <span style={{ background: persona.color }} className="inline-block h-1.5 w-1.5 rounded-full" />
                  {persona.name}
                </FilterPill>
              ))}
            </div>
          </>
        )}

        {hasActiveFilter && (
          <button type="button"
            onClick={() => { setSearch(""); setVerdictFilter("all"); setStatusFilter("all"); setPersonaFilter("all"); }}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground">
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <IconLoader2 size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-center">
            <IconBrandLinkedin size={32} className="text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              {hasActiveFilter ? "No prospects match these filters" : "No prospects captured yet"}
            </p>
            {hasActiveFilter && (
              <button type="button" onClick={() => { setSearch(""); setVerdictFilter("all"); setStatusFilter("all"); setPersonaFilter("all"); }}
                className="text-xs text-primary hover:underline">Clear filters</button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="py-2 pl-3 pr-1 w-8">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAll}
                    className="rounded border-border"
                    title="Select all"
                  />
                </th>
                <th className="py-2 pl-2 pr-3 text-left text-xs font-medium text-muted-foreground">Person</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Fit</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Draft note</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Email</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Phone</th>
                <th className="py-2 pl-3 pr-4 text-left text-xs font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const isChecked = selectedIds.has(p.id);
                const note = p.draftNote ?? "";
                const displayName = p.name ?? p.profileUrl;
                return (
                  <tr
                    key={p.id}
                    className={`group border-b border-border last:border-0 transition-colors cursor-pointer ${isChecked ? "bg-muted/60" : "hover:bg-muted/40"}`}
                    onClick={() => setSelectedId(p.id)}
                  >
                    {/* Checkbox */}
                    <td className="py-3 pl-3 pr-1 w-8" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelect(p.id)}
                        className="rounded border-border"
                      />
                    </td>

                    {/* Person */}
                    <td className="py-3 pl-2 pr-3">
                      <div className="flex items-center gap-1.5">
                        <IconBrandLinkedin size={13} className="shrink-0 text-[#0077B5]" />
                        <span className="font-medium text-foreground group-hover:text-primary truncate max-w-[180px]">{displayName}</span>
                        {p.personaName && p.personaColor && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shrink-0">
                            <span style={{ background: p.personaColor }} className="inline-block h-1.5 w-1.5 rounded-full" />
                            {p.personaName}
                          </span>
                        )}
                      </div>
                      {(p.role || p.company) && (
                        <p className="mt-0.5 text-xs text-muted-foreground truncate max-w-[240px]">
                          {[p.role, p.company].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </td>

                    {/* Fit */}
                    <td className="px-3 py-3 min-w-[150px]">
                      <VerdictBadge verdict={p.fitVerdict} />
                      {p.fitReason && (
                        <p className="mt-1 max-w-[200px] text-xs text-muted-foreground line-clamp-2">{p.fitReason}</p>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-3 py-3"><StatusBadge status={p.status} /></td>

                    {/* Draft note */}
                    <td className="px-3 py-3 max-w-xs">
                      {note ? (
                        <p className="text-xs text-muted-foreground line-clamp-2">{note}</p>
                      ) : (
                        <span className="text-xs text-muted-foreground/50 italic">
                          {p.status === "captured" ? "Drafting…" : "No note"}
                        </span>
                      )}
                    </td>

                    {/* Email */}
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <EnrichedField value={p.enrichedEmail} status={p.enrichmentStatus} kind="email" />
                    </td>

                    {/* Phone */}
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <EnrichedField value={p.enrichedPhone} status={p.enrichmentStatus} kind="phone" />
                    </td>

                    {/* Actions */}
                    <td className="py-3 pl-3 pr-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5">
                        {note && <CopyButton text={note} />}
                        <EnrichButton prospect={p} isEnriching={enrichingIds.has(p.id)} onEnrich={handleEnrich} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <ProspectSheet
          prospect={selected}
          onClose={() => setSelectedId(null)}
          onUpdated={() => refetch()}
          onDeleted={() => { setSelectedId(null); refetch(); }}
        />
      )}
    </div>
  );
}
