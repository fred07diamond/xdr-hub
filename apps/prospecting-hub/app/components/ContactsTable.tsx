import {
  callAction,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";
import {
  IconArrowsSort,
  IconBrandLinkedin,
  IconChevronDown,
  IconChevronUp,
  IconExternalLink,
  IconLoader2,
  IconRefresh,
  IconSearch,
  IconUsers,
  IconWand,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { CompanyLogo } from "@/components/CompanyLogo";
import { ContactDrawer } from "@/components/ContactDrawer";
import { FilterPill } from "@/components/FilterPill";
import { Pagination } from "@/components/Pagination";
import { buildOverallScoreBreakdown, SCORE_INFO, ScorePill } from "@/components/ScorePill";
import { SourceBadge } from "@/components/SourceBadge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { applyShiftClickSelection } from "@/lib/selection";

// The shared, filterable/sortable/multi-selectable contact table used by
// both the Contacts page (app/routes/contacts.tsx, org-wide pool) and the
// List-detail page (app/routes/lists.tsx's ListDetailView, scoped to one
// segment via `segmentId`). Previously the List-detail page had its own
// flat, unpaginated, non-filterable copy of this table — extracted here so
// the two pages can't drift apart again the way they already had once.

const DEFAULT_PERSONA_COLOR = "#94a3b8";
const PAGE_SIZE = 50;

// Each rescored contact needs a completeText() call plus (when applicable)
// two now-parallelized CommonRoom MCP round-trips (commonroom-engagement.ts)
// — a single "refresh all" call over dozens of contacts routinely exceeds
// the framework's 60s default action timeout. Chunking keeps each
// individual request comfortably bounded and lets the UI show real
// progress instead of one long spinner that can time out with no partial
// result. Reduced from 12 after a live production timeout on a 12-contact
// chunk ("1 batch had errors: the request took too long") — even with the
// two CommonRoom calls now parallelized per contact, worst-case latency
// across enough sequential contacts can still approach the hosting
// platform's 75s function limit; this leaves more headroom.
export const RESCORE_CHUNK_SIZE = 8;
export const RESCORE_CHUNK_TIMEOUT_MS = 150_000;
// Draft generation needs up to 2 completeText() calls per contact (the
// compliance-guard retry from draft-outreach.ts's post-generation check),
// each with a longer max output than scoring's — live-confirmed in
// production that a 12-contact chunk here can exceed the hosting platform's
// server-side function timeout, surfacing as a raw HTML "Inactivity Timeout"
// error page instead of a clean action error. A smaller chunk keeps worst-
// case sequential LLM calls per invocation comfortably bounded.
export const DRAFT_CHUNK_SIZE = 3;

export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

// A request that times out at the hosting platform's infrastructure layer
// (a load balancer or edge proxy, not this app's own server code) can come
// back as a raw HTML error page instead of a JSON action error — callAction
// surfaces that page's full markup as `err.message` verbatim. Detect that
// case and show a clean, actionable message instead of dumping raw HTML
// into the UI.
export function sanitizeActionError(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/<(!doctype|html)[\s>]/i.test(message)) {
    return "The request took too long and timed out — try again with a smaller selection.";
  }
  return message || fallback;
}

export type SortableColumn =
  | "name"
  | "company"
  | "overallScore"
  | "personaMatchScore"
  | "companyFitScore"
  | "engagementScore"
  | "source"
  | "status"
  | "syncedAt";

export function SortableTh({
  column,
  label,
  sortBy,
  sortDirection,
  onSort,
  className,
}: {
  column: SortableColumn;
  label: string;
  sortBy: SortableColumn | null;
  sortDirection: "asc" | "desc";
  onSort: (column: SortableColumn) => void;
  className?: string;
}) {
  const active = sortBy === column;
  return (
    <th className={`px-4 py-2 font-medium ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : ""}`}
      >
        {label}
        {active ? (
          sortDirection === "asc" ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />
        ) : (
          <IconArrowsSort size={12} className="text-muted-foreground/40" />
        )}
      </button>
    </th>
  );
}

export interface ContactRow {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  email: string | null;
  linkedinUrl: string | null;
  hubspotUrl: string | null;
  source: "hubspot" | "commonroom" | "prospector";
  status: "active" | "actioned";
  personaMatchScore: number | null;
  companyFitScore: number | null;
  engagementScore: number | null;
  hubspotQlScore: number | null;
  commonRoomIntentScore: number | null;
  commonRoomCompanyFitScore: number | null;
  apolloCompanyFitScore: number | null;
  apolloIntentScore: number | null;
  overallScore: number | null;
  scoreReasoning: string | null;
  personaId: string | null;
  personaName: string | null;
  personaColor: string | null;
  syncedAt: string | null;
  segments: Array<{ id: string; name: string }>;
}

interface PersonaOption {
  id: string;
  name: string;
  color: string | null;
}

function relativeTime(iso: string | null) {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

export interface ContactsTableProps {
  /**
   * Scope every query and bulk action this table performs (including the
   * "refresh/generate for all active contacts" fallback when nothing is
   * selected) to only contacts that are members of this segment. Omit for
   * the org-wide Contacts pool.
   */
  segmentId?: string;
  /**
   * Whether to show the persona quick-filter chip row. Defaults to true
   * (Contacts page). The List-detail page passes false: a single sourced
   * list is usually already persona-scoped by construction (it was either
   * built from one persona or by a sourcing rule targeting one), so a
   * second persona filter on top would mostly just filter an
   * already-filtered set down to itself or to nothing.
   */
  showPersonaFilter?: boolean;
  /**
   * Notified whenever this table's underlying total/loading state changes,
   * so a page-level header (e.g. Contacts' "N contacts across HubSpot and
   * CommonRoom" subtitle) can report the same numbers without this table's
   * own filtered/paginated query and a second, separate page-level query
   * disagreeing with each other.
   */
  onStatsChange?: (stats: { total: number; isLoading: boolean }) => void;
}

export function ContactsTable({ segmentId, showPersonaFilter = true, onStatsChange }: ContactsTableProps) {
  const [search, setSearch] = useState("");
  const [personaId, setPersonaId] = useState("");
  const [source, setSource] = useState<"" | ContactRow["source"]>("");
  const [status, setStatus] = useState<"" | ContactRow["status"]>("");
  const [offset, setOffset] = useState(0);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortableColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rescoreError, setRescoreError] = useState<string | null>(null);
  const [refreshProgress, setRefreshProgress] = useState<{ done: number; total: number } | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftProgress, setDraftProgress] = useState<{ done: number; total: number } | null>(null);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  // Anchor row (by id) for shift-click range select.
  const lastCheckedRowIdRef = useRef<string | null>(null);

  const { data: personasData } = useActionQuery("list-personas", {}, { enabled: showPersonaFilter });
  const personaOptions: PersonaOption[] = (personasData as { personas?: PersonaOption[] })?.personas ?? [];

  const queryArgs = useMemo(
    () => ({
      search: search.trim() || undefined,
      personaId: personaId || undefined,
      source: source || undefined,
      status: status || undefined,
      segmentId,
      sortBy: sortBy ?? undefined,
      sortDirection,
      limit: PAGE_SIZE,
      offset,
    }),
    [search, personaId, source, status, segmentId, sortBy, sortDirection, offset],
  );

  const { data, isLoading, refetch } = useActionQuery("list-contacts", queryArgs, {
    refetchInterval: 30000,
    staleTime: 25000,
  });

  const markActioned = useActionMutation("mark-contact-actioned");

  const contacts: ContactRow[] = (data as { contacts?: ContactRow[] })?.contacts ?? [];
  const total = (data as { total?: number })?.total ?? 0;

  useEffect(() => {
    onStatsChange?.({ total, isLoading });
    // onStatsChange is expected to be a stable setter (useState setter or
    // similarly identity-stable) — omitting it from deps avoids re-firing on
    // every render of a caller that passes an inline arrow function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, isLoading]);

  function resetToFirstPage() {
    setOffset(0);
  }

  function handleSort(column: SortableColumn) {
    if (sortBy === column) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortDirection("desc");
    }
    resetToFirstPage();
  }

  async function handleMarkActioned(contactId: string) {
    setActioningId(contactId);
    try {
      await markActioned.mutateAsync({ contactId });
      refetch();
    } finally {
      setActioningId(null);
    }
  }

  function toggleSelected(contactId: string, index: number, shiftKey: boolean) {
    setSelected((prev) => applyShiftClickSelection(contacts, index, shiftKey, lastCheckedRowIdRef.current, prev));
    lastCheckedRowIdRef.current = contactId;
  }

  function toggleSelectAllOnPage() {
    setSelected((prev) => {
      const allSelected = contacts.length > 0 && contacts.every((c) => prev.has(c.id));
      if (allSelected) {
        const next = new Set(prev);
        contacts.forEach((c) => next.delete(c.id));
        return next;
      }
      const next = new Set(prev);
      contacts.forEach((c) => next.add(c.id));
      return next;
    });
  }

  async function handleRefreshScores() {
    setRescoreError(null);

    let targetIds: string[];
    if (selected.size > 0) {
      targetIds = Array.from(selected);
    } else {
      // "Refresh all" — fetch every active contact id directly (not just the
      // current page's `contacts` array, which is paginated/filtered) so a
      // refresh-all click always covers the full active pool. When
      // `segmentId` is set this means "all active contacts in this list",
      // not the org-wide pool — list-contacts ANDs segmentId in for us.
      try {
        const all = await callAction<{ contacts: Array<{ id: string }> }>(
          "list-contacts",
          { status: "active", segmentId, limit: 200, offset: 0 },
          { method: "GET" },
        );
        targetIds = all.contacts.map((c) => c.id);
      } catch (err) {
        setRescoreError(sanitizeActionError(err, "Couldn't load contacts to refresh."));
        return;
      }
    }

    if (targetIds.length === 0) return;

    const chunks = chunkArray(targetIds, RESCORE_CHUNK_SIZE);
    setRefreshProgress({ done: 0, total: targetIds.length });
    const errors: string[] = [];
    let done = 0;

    for (const chunk of chunks) {
      try {
        const result = await callAction<{ rescored?: number; error?: string; errors?: string[] }>(
          "rescore-contacts",
          { contactIds: chunk },
          { timeoutMs: RESCORE_CHUNK_TIMEOUT_MS },
        );
        if (result?.error) errors.push(result.error);
        if (result?.errors?.length) errors.push(...result.errors);
      } catch (err) {
        errors.push(sanitizeActionError(err, "A batch failed to refresh."));
      }
      done += chunk.length;
      setRefreshProgress({ done, total: targetIds.length });
    }

    setRefreshProgress(null);
    if (errors.length > 0) {
      setRescoreError(`${errors.length} batch${errors.length === 1 ? "" : "es"} had errors: ${errors[0]}`);
    }
    setSelected(new Set());
    refetch();
  }

  // Same chunked-callAction pattern as handleRefreshScores above, but with a
  // smaller chunk size — draft generation can need up to 2 completeText()
  // calls per contact (see DRAFT_CHUNK_SIZE's comment), unlike scoring's
  // single, shorter call.
  async function handleGenerateOutreach() {
    setDraftError(null);

    let targetIds: string[];
    if (selected.size > 0) {
      targetIds = Array.from(selected);
    } else {
      try {
        const all = await callAction<{ contacts: Array<{ id: string }> }>(
          "list-contacts",
          { status: "active", segmentId, limit: 200, offset: 0 },
          { method: "GET" },
        );
        targetIds = all.contacts.map((c) => c.id);
      } catch (err) {
        setDraftError(sanitizeActionError(err, "Couldn't load contacts to draft for."));
        return;
      }
    }

    if (targetIds.length === 0) return;

    const chunks = chunkArray(targetIds, DRAFT_CHUNK_SIZE);
    setDraftProgress({ done: 0, total: targetIds.length });
    const errors: string[] = [];
    let done = 0;

    for (const chunk of chunks) {
      try {
        const result = await callAction<{ generated?: number; errors?: string[] }>(
          "bulk-generate-drafts",
          { contactIds: chunk },
          { timeoutMs: RESCORE_CHUNK_TIMEOUT_MS },
        );
        if (result?.errors?.length) errors.push(...result.errors);
      } catch (err) {
        errors.push(sanitizeActionError(err, "A batch failed to generate drafts."));
      }
      done += chunk.length;
      setDraftProgress({ done, total: targetIds.length });
    }

    setDraftProgress(null);
    if (errors.length > 0) {
      setDraftError(`${errors.length} contact${errors.length === 1 ? "" : "s"} had errors: ${errors[0]}`);
    }
    setSelected(new Set());
    refetch();
  }

  const allOnPageSelected = contacts.length > 0 && contacts.every((c) => selected.has(c.id));
  const activeScopeLabel = segmentId ? "all active contacts in this list" : "all active contacts";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-end gap-2 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={handleRefreshScores}
          disabled={refreshProgress !== null || total === 0}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
          title={selected.size > 0 ? `Re-score ${selected.size} selected contact${selected.size === 1 ? "" : "s"}` : `Re-score ${activeScopeLabel} (capped at 200 per run)`}
        >
          {refreshProgress ? (
            <IconLoader2 size={13} className="animate-spin" />
          ) : (
            <IconRefresh size={13} />
          )}
          {refreshProgress
            ? `Refreshing ${refreshProgress.done}/${refreshProgress.total}…`
            : selected.size > 0
              ? `Refresh ${selected.size} selected`
              : "Refresh scores"}
        </button>
        <button
          type="button"
          onClick={handleGenerateOutreach}
          disabled={draftProgress !== null || total === 0}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
          title={selected.size > 0 ? `Generate outreach for ${selected.size} selected contact${selected.size === 1 ? "" : "s"}` : `Generate outreach for ${activeScopeLabel} (capped at 200 per run)`}
        >
          {draftProgress ? (
            <IconLoader2 size={13} className="animate-spin" />
          ) : (
            <IconWand size={13} />
          )}
          {draftProgress
            ? `Generating ${draftProgress.done}/${draftProgress.total}…`
            : selected.size > 0
              ? `Generate outreach for ${selected.size} selected`
              : "Generate Outreach"}
        </button>
      </div>

      {rescoreError && (
        <p role="alert" className="border-b border-border bg-destructive/5 px-4 py-2 text-xs text-destructive">{rescoreError}</p>
      )}
      {draftError && (
        <p role="alert" className="border-b border-border bg-destructive/5 px-4 py-2 text-xs text-destructive">{draftError}</p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="relative">
          <IconSearch size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetToFirstPage(); }}
            placeholder="Search name or company"
            className="w-56 rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        {showPersonaFilter && (
          <div className="flex flex-wrap items-center gap-1.5">
            <FilterPill active={personaId === ""} onClick={() => { setPersonaId(""); resetToFirstPage(); }}>
              All
            </FilterPill>
            {personaOptions.map((p) => {
              const active = personaId === p.id;
              const color = p.color ?? DEFAULT_PERSONA_COLOR;
              return (
                <FilterPill
                  key={p.id}
                  active={active}
                  color={color}
                  onClick={() => { setPersonaId(active ? "" : p.id); resetToFirstPage(); }}
                >
                  <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                  {p.name}
                </FilterPill>
              );
            })}
          </div>
        )}
        <Select
          value={source || "all"}
          onValueChange={(v) => {
            setSource(v === "all" ? "" : (v as ContactRow["source"]));
            resetToFirstPage();
          }}
        >
          <SelectTrigger className="h-auto w-auto gap-1.5 rounded-md border-border px-2 py-1.5 text-xs">
            <SelectValue placeholder="All sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="hubspot">HubSpot</SelectItem>
            <SelectItem value="commonroom">CommonRoom</SelectItem>
            <SelectItem value="prospector">Prospector</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={status || "all"}
          onValueChange={(v) => {
            setStatus(v === "all" ? "" : (v as ContactRow["status"]));
            resetToFirstPage();
          }}
        >
          <SelectTrigger className="h-auto w-auto gap-1.5 rounded-md border-border px-2 py-1.5 text-xs">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="actioned">Actioned</SelectItem>
          </SelectContent>
        </Select>
        {selected.size > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">
            {selected.size} selected
            <button type="button" onClick={() => setSelected(new Set())} className="ml-2 text-primary hover:underline">
              Clear
            </button>
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <IconLoader2 size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : contacts.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-3 text-center">
            <IconUsers size={32} className="text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">No contacts match these filters</p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                {segmentId
                  ? "Adjust the filters above, or refresh this list to pull in more contacts."
                  : "Sync from HubSpot or CommonRoom, or adjust the filters above."}
              </p>
            </div>
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 border-b border-border bg-background text-muted-foreground">
              <tr>
                <th className="px-4 py-2">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={toggleSelectAllOnPage}
                    aria-label="Select all on page"
                    className="size-3.5 rounded border-border"
                  />
                </th>
                <SortableTh column="name" label="Name" sortBy={sortBy} sortDirection={sortDirection} onSort={handleSort} />
                <SortableTh column="company" label="Company" sortBy={sortBy} sortDirection={sortDirection} onSort={handleSort} />
                <th className="px-4 py-2 font-medium">Persona</th>
                <SortableTh column="overallScore" label="Overall Score" sortBy={sortBy} sortDirection={sortDirection} onSort={handleSort} />
                <SortableTh column="personaMatchScore" label="Persona Match" sortBy={sortBy} sortDirection={sortDirection} onSort={handleSort} />
                <SortableTh column="companyFitScore" label="Company Fit" sortBy={sortBy} sortDirection={sortDirection} onSort={handleSort} />
                <SortableTh column="engagementScore" label="Engagement" sortBy={sortBy} sortDirection={sortDirection} onSort={handleSort} />
                <SortableTh column="source" label="Source" sortBy={sortBy} sortDirection={sortDirection} onSort={handleSort} />
                <SortableTh column="status" label="Status" sortBy={sortBy} sortDirection={sortDirection} onSort={handleSort} />
                <th className="px-4 py-2 font-medium">Lists</th>
                <SortableTh column="syncedAt" label="Synced" sortBy={sortBy} sortDirection={sortDirection} onSort={handleSort} />
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {contacts.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setSelectedContactId(c.id)}
                  className={`cursor-pointer hover:bg-muted/30 ${selected.has(c.id) ? "bg-primary/5" : ""}`}
                >
                  <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => {}}
                      onClick={(e) => toggleSelected(c.id, contacts.indexOf(c), e.shiftKey)}
                      aria-label={`Select ${c.name}`}
                      className="size-3.5 rounded border-border"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-foreground">{c.name}</p>
                    {c.title && <p className="text-muted-foreground/70">{c.title}</p>}
                  </td>
                  <td className="px-4 py-2.5 text-foreground">
                    {c.company ? (
                      <span className="flex items-center gap-2.5">
                        <CompanyLogo name={c.company} domain={null} />
                        {c.company}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {c.personaName ? (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        <span
                          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: c.personaColor ?? DEFAULT_PERSONA_COLOR }}
                        />
                        {c.personaName}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50">Unscored</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5"><ScorePill score={c.overallScore} size="lg" breakdown={buildOverallScoreBreakdown(c)} /></td>
                  <td className="px-4 py-2.5">
                    <ScorePill
                      score={c.personaMatchScore}
                      info={{ ...SCORE_INFO.personaMatch, reasoning: c.scoreReasoning }}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <ScorePill
                      score={c.companyFitScore}
                      info={{ ...SCORE_INFO.companyFit, reasoning: c.scoreReasoning }}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <ScorePill score={c.engagementScore} info={SCORE_INFO.engagement} />
                  </td>
                  <td className="px-4 py-2.5"><SourceBadge source={c.source} hubspotUrl={c.hubspotUrl} /></td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${c.status === "actioned" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                      {c.status === "actioned" ? "Actioned" : "Active"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {c.segments.length === 0 ? (
                      <span className="text-muted-foreground/50">—</span>
                    ) : (
                      <span className="text-muted-foreground">
                        {c.segments.slice(0, 2).map((s) => s.name).join(", ")}
                        {c.segments.length > 2 && ` +${c.segments.length - 2}`}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{relativeTime(c.syncedAt)}</td>
                  <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      {c.linkedinUrl && (
                        <a href={c.linkedinUrl} target="_blank" rel="noreferrer" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="Open LinkedIn profile">
                          <IconBrandLinkedin size={14} />
                        </a>
                      )}
                      {c.hubspotUrl && (
                        <a href={c.hubspotUrl} target="_blank" rel="noreferrer" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="Open in HubSpot">
                          <IconExternalLink size={14} />
                        </a>
                      )}
                      {c.status === "active" && (
                        <button
                          type="button"
                          onClick={() => handleMarkActioned(c.id)}
                          disabled={actioningId === c.id}
                          className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                        >
                          {actioningId === c.id ? "…" : "Mark actioned"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {total > 0 && (
        <div className="flex items-center justify-end border-t border-border px-4 py-2">
          <Pagination
            page={offset / PAGE_SIZE + 1}
            pageSize={PAGE_SIZE}
            totalCount={total}
            onPageChange={(p) => setOffset((p - 1) * PAGE_SIZE)}
          />
        </div>
      )}

      <ContactDrawer contactId={selectedContactId} onClose={() => setSelectedContactId(null)} />
    </div>
  );
}
