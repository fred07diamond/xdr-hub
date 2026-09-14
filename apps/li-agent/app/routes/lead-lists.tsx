import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { IconCheck, IconDownload, IconExternalLink, IconListCheck, IconLoader2, IconPencil, IconSparkles, IconTrash, IconUsers, IconX } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { APP_TITLE } from "@/lib/app-config";
import { StellarMark, VerdictBadge } from "@/components/badges";
import { EnrichCostConfirm } from "@/components/EnrichCostConfirm";
import { RevealPhoneButton } from "@/components/RevealPhoneButton";
import { useApolloEnrichment } from "@/lib/apollo-enrichment";
import {
  describeEnrichmentState,
  describePhoneRevealState,
  TONE_CLASS,
} from "@/lib/enrichment-vocabulary";
import { BULK_HALT_CODES, BULK_MAX_CONSECUTIVE_FAILURES, CREDITS_PER_PHONE_REVEAL, describeHalt, MAX_BULK_ENRICH, MAX_BULK_SCORE, type BulkHaltState } from "@/lib/apollo-limits";
import { isBulkEligibleQuality, leadQuality, sortByQuality } from "@/lib/lead-quality";
import { CsvExportModal } from "@/components/CsvExportModal";
import { HotLeadsSection } from "@/components/HotLeadsSection";
import { OutreachPanel } from "@/components/OutreachPanel";
import {
  LIST_SORT_STORAGE_KEY,
  LIST_SORTS,
  sortLeadLists,
  type ListSort,
} from "@/lib/lead-list-sort";
import { applyShiftClickSelection } from "@/lib/selection";
import { cn } from "@/lib/utils";
import { Pagination } from "@/components/Pagination";

type LeadListItem = {
  id: string;
  listId: string;
  name: string | null;
  headline: string | null;
  company: string | null;
  location: string | null;
  profileUrl: string | null;
  salesNavLeadUrl: string | null;
  personaId: string | null;
  personaName: string | null;
  personaColor: string | null;
  enrichmentStatus: "idle" | "enriching" | "done" | "not_found" | "failed";
  enrichedEmail: string | null;
  enrichedTitle: string | null;
  enrichedPhone: string | null;
  enrichedLinkedinUrl: string | null;
  enrichedCompanyIndustry: string | null;
  enrichedCompanySize: number | null;
  enrichedAt: string | null;
  enrichmentError: string | null;
  enrichmentSource: string | null;
  enrichedEmailStatus: string | null;
  phoneRevealStatus: "requested" | "done" | "no_match" | "failed" | null;
  phoneRevealRequestedAt: string | null;
  promotedProspectId: string | null;
  // Score-first: a lead carries its own verdict before (and possibly
  // without ever) being promoted into a prospects row.
  fitVerdict: "strong" | "possible" | "weak" | "inconclusive" | null;
  fitReason: string | null;
};

// Apollo doesn't always send a phone-reveal webhook back for a genuine
// "no number found" outcome (sometimes it just never calls back, with
// nothing identifying which request that silence was for) -- so a
// "requested" status can't be trusted to resolve on its own forever. Past
// this age, treat it the same as "done, nothing found" rather than showing
// "Revealing…" indefinitely.
const PHONE_REVEAL_STALE_AFTER_MS = 5 * 60 * 1000;

function isPhoneRevealStale(requestedAt: string | null): boolean {
  if (!requestedAt) return true;
  return Date.now() - new Date(requestedAt).getTime() > PHONE_REVEAL_STALE_AFTER_MS;
}

// Provenance tooltip for an enriched field -- which Apollo call produced it,
// when, and (email only) Apollo's own confidence in the match.
function describeEnrichmentProvenance(
  kind: "email" | "phone",
  source: string | null,
  emailStatus: string | null,
  enrichedAt: string | null,
): string | null {
  if (!source) return null;
  const via = source === "apollo_phone_reveal" ? "Apollo phone reveal" : "Apollo";
  const status = kind === "email" && emailStatus ? ` · ${emailStatus}` : "";
  const when = enrichedAt && !Number.isNaN(new Date(enrichedAt).getTime())
    ? ` · enriched ${new Date(enrichedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
    : "";
  return `${via}${status}${when}`;
}

type LeadList = {
  id: string;
  name: string;
  description: string | null;
  salesNavListUrl: string | null;
  totalCount: number;
  createdAt: string | null;
};

// Two lists with the same/similar name are otherwise indistinguishable in
// the master rail except for the lead count, which is easy to misread or
// overlook -- created date disambiguates them without needing a click.
function formatListCreatedAt(createdAt: string | null): string | null {
  if (!createdAt) return null;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Prefer the resolved public profile URL; it's null until the xDR actually
// opens the lead's profile and the existing capture flow fills it in. Until
// then, fall back to the Sales Nav lead URL captured at import time, which
// is always present.
function linkedInUrl(item: LeadListItem): string {
  if (item.profileUrl) return item.profileUrl;
  if (item.salesNavLeadUrl) return item.salesNavLeadUrl;
  const parts = [item.name, item.company].filter(Boolean);
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(parts.join(" "))}`;
}

function EnrichedField({
  value,
  status,
  kind,
  phoneRevealStatus,
  phoneRevealRequestedAt,
  enrichmentSource,
  enrichedEmailStatus,
  enrichedAt,
  isEnriching,
  onEnrich,
}: {
  value: string | null;
  status: LeadListItem["enrichmentStatus"];
  kind: "email" | "phone";
  phoneRevealStatus?: LeadListItem["phoneRevealStatus"];
  phoneRevealRequestedAt?: LeadListItem["phoneRevealRequestedAt"];
  enrichmentSource?: string | null;
  enrichedEmailStatus?: string | null;
  enrichedAt?: string | null;
  isEnriching?: boolean;
  onEnrich?: () => void;
}) {
  // Called unconditionally, before any early return -- hooks cannot sit behind
  // a conditional. Each row calls it rather than threading a prop through the
  // whole table; react-query dedupes, so 25 rows issue one request.
  const apollo = useApolloEnrichment();

  if (value) {
    const provenance = describeEnrichmentProvenance(kind, enrichmentSource ?? null, enrichedEmailStatus ?? null, enrichedAt ?? null);
    return (
      <span className="text-xs truncate max-w-[170px] block" title={provenance ?? undefined}>
        {value}
      </span>
    );
  }
  if (isEnriching || status === "enriching") {
    return <span className="text-xs italic text-muted-foreground/70">Looking up…</span>;
  }

  // Shared with the Prospects table via app/lib/enrichment-vocabulary.ts. The
  // two tables used to phrase these states with their own inline ternaries,
  // which is how "not found", "failed" and "never enriched" ended up reading
  // as the same thing.
  const state =
    kind === "phone"
      ? describePhoneRevealState(
          phoneRevealStatus ?? null,
          false,
          status ?? null,
          isPhoneRevealStale(phoneRevealRequestedAt ?? null),
        )
      : describeEnrichmentState(status ?? null, false, kind);

  const cls = `text-xs ${TONE_CLASS[state.tone]}`;

  // Retry is offered only where it can change the answer -- see the note in
  // _index.tsx's copy of this decision.
  if (!onEnrich || !apollo.enabled || !state.retryable) {
    return (
      <span className={cls} title={state.detail}>
        {state.label}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onEnrich}
      title={state.detail}
      className={`${cls} underline decoration-dotted underline-offset-2 hover:text-foreground`}
    >
      {state.label}
    </button>
  );
}

function EnrichButton({
  item,
  isEnriching,
  onEnrich,
}: {
  item: LeadListItem;
  isEnriching: boolean;
  onEnrich: (item: LeadListItem) => void;
}) {
  const apollo = useApolloEnrichment();
  if (isEnriching || item.enrichmentStatus === "enriching") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <IconLoader2 size={11} className="animate-spin" />
        Enriching…
      </span>
    );
  }

  // isLoading is rendered as a NEUTRAL pending state, not as "disabled":
  // treating the in-flight status as false would flash "paused" on every
  // page load before it settles.
  if (apollo.isLoading) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-border/50 px-2 py-1 text-[11px] text-muted-foreground/40">
        <IconSparkles size={11} />
        Enrich
      </span>
    );
  }

  if (!apollo.enabled) {
    return (
      <span
        title={apollo.message}
        className="inline-flex items-center gap-1 rounded-md border border-border/50 px-2 py-1 text-[11px] text-muted-foreground/40"
      >
        <IconSparkles size={11} />
        Enrich
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onEnrich(item)}
      title={item.enrichmentError ?? undefined}
      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted"
    >
      <IconSparkles size={11} />
      {item.enrichmentStatus === "done"
        ? "Re-enrich"
        : item.enrichmentStatus === "failed" || item.enrichmentStatus === "not_found"
        ? "Retry enrich"
        : "Enrich"}
    </button>
  );
}

function LeadListItemRow({
  item,
  index,
  isEnriching,
  isChecked,
  onToggle,
  onOpen,
  onEnrich,
  onRevealed,
}: {
  item: LeadListItem;
  index: number;
  isEnriching: boolean;
  isChecked: boolean;
  onToggle: (id: string, index: number, shiftKey: boolean) => void;
  onOpen: (item: LeadListItem) => void;
  onEnrich: (item: LeadListItem) => void;
  onRevealed: () => void;
}) {
  const quality = leadQuality(item);
  const isStellar = quality === "stellar";
  return (
    <tr
      className={cn(
        "border-b border-border last:border-b-0 transition-colors hover:bg-muted/40",
        // Selection styling still wins, so a checked stellar row reads as
        // checked rather than as two competing tints.
        isStellar && !isChecked && "bg-amber-500/[0.04] hover:bg-amber-500/[0.08]",
        isChecked && "bg-muted/60",
      )}
    >
      {/* The accent goes on the first CELL, not the row: a border on a <tr>
          does not render under border-collapse: collapse, which is the
          browser default and what this table uses. */}
      <td className={cn("py-3 pl-4 pr-1 w-8", isStellar && "border-l-2 border-l-amber-500/60")}>
        <input
          type="checkbox"
          checked={isChecked}
          onChange={() => {}}
          onClick={(e) => onToggle(item.id, index, e.shiftKey)}
          className="rounded border-border"
        />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          {/* First in the row, so the leads worth spending credits on are the
              ones the eye lands on. */}
          {quality === "stellar" && <StellarMark personaName={item.personaName} />}
          <p className="text-sm font-medium">{item.name ?? "—"}</p>
          {item.personaName && item.personaColor && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shrink-0">
              <span style={{ background: item.personaColor }} className="inline-block h-1.5 w-1.5 rounded-full" />
              {item.personaName}
            </span>
          )}
          {/* The first fit signal this page has ever shown. Before score-first
              the verdict only existed on the promoted prospects row. */}
          <VerdictBadge verdict={item.fitVerdict} fallback={null} title={item.fitReason ?? undefined} />
          {item.promotedProspectId && (
            <a
              href="/"
              title="Scored, drafted, and promoted into Prospects by the automatic pipeline"
              className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 shrink-0 hover:bg-emerald-500/20"
            >
              <IconCheck size={10} />
              In Prospects
            </a>
          )}
        </div>
        {item.location && (
          <p className="text-[11px] text-muted-foreground truncate max-w-[180px]">{item.location}</p>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{item.headline ?? "—"}</td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{item.company ?? "—"}</td>
      <td className="px-4 py-3">
        <EnrichedField
          value={item.enrichedEmail}
          status={item.enrichmentStatus}
          kind="email"
          enrichmentSource={item.enrichmentSource}
          enrichedEmailStatus={item.enrichedEmailStatus}
          enrichedAt={item.enrichedAt}
          isEnriching={isEnriching}
          onEnrich={() => onEnrich(item)}
        />
      </td>
      <td className="px-4 py-3">
        {/* NO onEnrich. The empty phone cell used to be a dotted-underline
            click target that fired an 8-credit reveal with no confirmation --
            the most expensive action in the app was its least deliberate one.
            The empty state is now inert text, and RevealPhoneButton owns the
            spend. Email keeps its one-click affordance: 1 credit, recoverable,
            and a long-established habit. */}
        <div className="flex items-center gap-2">
          <EnrichedField
            value={item.enrichedPhone}
            status={item.enrichmentStatus}
            kind="phone"
            phoneRevealStatus={item.phoneRevealStatus}
            phoneRevealRequestedAt={item.phoneRevealRequestedAt}
            enrichmentSource={item.enrichmentSource}
            enrichedAt={item.enrichedAt}
            isEnriching={isEnriching}
          />
          {!item.enrichedPhone && item.phoneRevealStatus !== "requested" && (
            <RevealPhoneButton
              source="lead_list_item"
              id={item.id}
              fitVerdict={item.fitVerdict}
              fitReason={item.fitReason}
              noNumberKnown={item.phoneRevealStatus === "no_match"}
              onRevealed={onRevealed}
            />
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onOpen(item)}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted"
          >
            <IconExternalLink size={11} />
            LinkedIn
          </button>
          <EnrichButton item={item} isEnriching={isEnriching} onEnrich={onEnrich} />
        </div>
      </td>
    </tr>
  );
}

export function meta() {
  return [{ title: `Lead Lists - ${APP_TITLE}` }];
}

export default function LeadListsPage() {
  // One shared read for the page-level bulk controls; rows call the hook
  // themselves and react-query dedupes to a single request.
  const apolloGate = useApolloEnrichment();
  useSetPageTitle("Lead Lists");

  // Selected list lives in the URL (?listId=), not just component state --
  // a plain useState here means the selection can't be shared in Slack,
  // bookmarked, or survive a refresh. `replace: true` swaps the current
  // history entry instead of pushing a new one per click, so clicking
  // through several lists doesn't turn Back into a long list-selection
  // replay.
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedListId = searchParams.get("listId");
  function setSelectedListId(listId: string | null) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (listId) next.set("listId", listId);
        else next.delete("listId");
        return next;
      },
      { replace: true },
    );
  }
  const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set());
  const [bulkEnrichProgress, setBulkEnrichProgress] = useState<{ done: number; total: number } | null>(null);
  // Persistent, not a toast: a bulk run takes ~100 seconds, so a toast
  // would be gone before anyone read why it stopped.
  const [bulkHalt, setBulkHalt] = useState<BulkHaltState | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [renamingListId, setRenamingListId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [scoreProgress, setScoreProgress] = useState<{ done: number; total: number } | null>(null);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [outreachLead, setOutreachLead] = useState<LeadListItem | null>(null);
  // Selected LISTS (distinct from selectedItemIds, which is leads within one
  // list). Deleting a list takes its leads with it, so these are deliberately
  // separate selections that cannot be confused for one another.
  const [selectedListIds, setSelectedListIds] = useState<Set<string>>(new Set());
  const [confirmDeleteLists, setConfirmDeleteLists] = useState(false);
  const [isDeletingLists, setIsDeletingLists] = useState(false);
  const lastCheckedListIdRef = useRef<string | null>(null);
  // Persisted, because a sort preference that resets on every page load is
  // worse than not having one. Read lazily so SSR does not touch localStorage.
  const [listSort, setListSort] = useState<ListSort>(() => {
    try {
      const stored = localStorage.getItem(LIST_SORT_STORAGE_KEY);
      if (stored && LIST_SORTS.some((o) => o.value === stored)) return stored as ListSort;
    } catch {
      // Private mode or blocked storage -- the default is fine.
    }
    return "newest";
  });

  function changeListSort(next: ListSort) {
    setListSort(next);
    // A reorder invalidates the shift-click anchor: the row it pointed at is
    // somewhere else now, and a range from it would select the wrong block.
    lastCheckedListIdRef.current = null;
    try {
      localStorage.setItem(LIST_SORT_STORAGE_KEY, next);
    } catch {
      // Not persisting is a minor annoyance, not an error worth surfacing.
    }
  }
  const [isDeletingItems, setIsDeletingItems] = useState(false);
  // Rows staged for the export preview. Null means the modal is closed; the
  // rows are snapshotted so a background refetch cannot change what is being
  // previewed out from under the person reading it.
  const [exportRequest, setExportRequest] = useState<
    { rows: LeadListItem[]; prefix: string } | null
  >(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const listsQuery = useActionQuery("list-lead-lists", {}, { refetchInterval: 30_000 });
  const rawLists = ((listsQuery.data as { lists?: LeadList[] } | undefined)?.lists ?? []);
  const lists: LeadList[] = useMemo(() => sortLeadLists(rawLists, listSort), [rawLists, listSort]);

  // Paginated -- a list can hold up to 500 items and this used to fetch
  // every one of them on every selection/poll. Page-number navigation,
  // not accumulating "Load more" -- switching lists resets back to page 1.
  // ITEMS_PAGE_SIZE_CAP mirrors get-lead-list-items.ts's own zod max(500) --
  // a list can't hold more than that anyway, and clamping here means typing
  // a bigger number just shows the whole list instead of erroring.
  const DEFAULT_ITEMS_PAGE_SIZE = 25;
  const ITEMS_PAGE_SIZE_CAP = 500;
  const [itemsPage, setItemsPage] = useState(1);
  const [itemsPageSize, setItemsPageSize] = useState(DEFAULT_ITEMS_PAGE_SIZE);

  useEffect(() => {
    setItemsPage(1);
  }, [selectedListId]);

  const itemsQuery = useActionQuery(
    "get-lead-list-items",
    { listId: selectedListId ?? "", limit: itemsPageSize, offset: (itemsPage - 1) * itemsPageSize },
    { enabled: !!selectedListId, refetchInterval: 5_000 },
  );

  const items: LeadListItem[] = (itemsQuery.data as { items?: LeadListItem[] } | undefined)?.items ?? [];
  const itemsTotalCount: number = (itemsQuery.data as { totalCount?: number } | undefined)?.totalCount ?? 0;

  const activeList = (itemsQuery.data as { list?: LeadList } | undefined)?.list ?? null;

  // Full list (up to IMPORT_LIMIT=500), independent of page navigation --
  // powers "select all N leads" and "Enrich all" so both operate over the
  // WHOLE list instead of silently only the current 25-row page.
  const allItemsQuery = useActionQuery(
    "get-lead-list-items",
    { listId: selectedListId ?? "", limit: 500, offset: 0 },
    { enabled: !!selectedListId, refetchInterval: 15_000 },
  );
  const allItems: LeadListItem[] = (allItemsQuery.data as { items?: LeadListItem[] } | undefined)?.items ?? [];

  const deleteList = useActionMutation("delete-lead-list");
  const renameList = useActionMutation("rename-lead-list");
  const bulkDeleteItems = useActionMutation("bulk-delete-lead-list-items");
  const revealPhone = useActionMutation("reveal-phone");
  const scoreItem = useActionMutation("score-lead-list-item");
  const enrichItem = useActionMutation("enrich-lead-list-item");

  // Status eligibility AND quality. This previously filtered on status
  // alone, so "Enrich all" happily spent credits on leads the ICP had already
  // scored weak.
  const enrichEligibleItems = allItems.filter(
    (i) =>
      (i.enrichmentStatus === "idle" || i.enrichmentStatus === "failed" || i.enrichmentStatus === "not_found") &&
      isBulkEligibleQuality(i),
  );
  const stellarEligibleItems = enrichEligibleItems.filter((i) => leadQuality(i) === "stellar");

  function handleOpenLinkedIn(item: LeadListItem) {
    window.open(linkedInUrl(item), "_blank", "noopener,noreferrer");
  }

  function openExport(rows: LeadListItem[], prefix: string) {
    if (rows.length === 0) return;
    setExportRequest({ rows, prefix });
  }

  /**
   * Enriches the rows the export modal asked about, then returns the CURRENT
   * data for them.
   *
   * Re-reads from the refetched query rather than trusting the enrich
   * responses: the rows handed in are a snapshot, and after enrichment the
   * authoritative values live on the server.
   */
  async function enrichForExport(rows: LeadListItem[]): Promise<LeadListItem[]> {
    const ids = new Set(rows.map((r) => r.id));
    await runBulkEnrich(rows, rows.length);
    const refreshed = await itemsQuery.refetch();
    const fresh = ((refreshed.data as { items?: LeadListItem[] } | undefined)?.items ?? []).filter((i) =>
      ids.has(i.id),
    );
    // Fall back to the snapshot for anything the refetched page no longer
    // covers (it is paginated), so the export never silently loses rows.
    const byId = new Map(fresh.map((f) => [f.id, f]));
    const merged = (exportRequest?.rows ?? rows).map((r) => byId.get(r.id) ?? r);
    setExportRequest((prev) => (prev ? { ...prev, rows: merged } : prev));
    return merged;
  }

  /**
   * Reveals phone numbers for the rows the export modal selected.
   *
   * Goes through the same reveal-phone action a single row uses, including its
   * confirmCredits echo, so the 8-credit price and the ledger attribution are
   * identical whether one number is revealed or forty. `override` stays FALSE:
   * the modal only ever passes rows that already clear the fit bar.
   */
  async function revealPhonesForExport(rows: LeadListItem[]): Promise<LeadListItem[]> {
    const ids = new Set(rows.map((r) => r.id));
    for (const row of rows.slice(0, MAX_BULK_ENRICH)) {
      const res = (await revealPhone.mutateAsync({
        source: "lead_list_item",
        id: row.id,
        confirmCredits: CREDITS_PER_PHONE_REVEAL,
        override: false,
      })) as { ok?: boolean; code?: string; error?: string } | undefined;
      if (res?.code && BULK_HALT_CODES.has(res.code)) {
        throw new Error(describeHalt(res.code, res.error));
      }
    }
    const refreshed = await itemsQuery.refetch();
    const fresh = ((refreshed.data as { items?: LeadListItem[] } | undefined)?.items ?? []).filter((i) =>
      ids.has(i.id),
    );
    const byId = new Map(fresh.map((f) => [f.id, f]));
    const merged = (exportRequest?.rows ?? rows).map((r) => byId.get(r.id) ?? r);
    setExportRequest((prev) => (prev ? { ...prev, rows: merged } : prev));
    return merged;
  }

  /**
   * Scores and drafts a batch of leads.
   *
   * This is the backfill path that did not exist. The background sweep only
   * scores leads imported after it shipped (autoEnrich), so every older list
   * has no verdict at all -- which is why the Fit column read blank and why
   * the export's phone toggle found nothing eligible: the fit bar cannot be
   * cleared by a lead that was never scored.
   *
   * Costs no Apollo credits. Scoring is an LLM call against the persona
   * criteria; the credit guard is not involved, which is precisely why the
   * pipeline scores BEFORE it spends.
   */
  async function runBulkScore(targets: LeadListItem[]) {
    const batch = targets.slice(0, MAX_BULK_SCORE);
    if (batch.length === 0) return;
    setScoreError(null);
    setScoreProgress({ done: 0, total: batch.length });
    let consecutiveFailures = 0;
    try {
      for (const item of batch) {
        try {
          const res = (await scoreItem.mutateAsync({ itemId: item.id })) as
            | { ok?: boolean; error?: string }
            | undefined;
          if (res?.error) throw new Error(res.error);
          consecutiveFailures = 0;
        } catch (err) {
          consecutiveFailures += 1;
          // A systemic failure (no ICP uploaded, model outage) would otherwise
          // repeat identically for every remaining lead.
          if (consecutiveFailures >= BULK_MAX_CONSECUTIVE_FAILURES) {
            setScoreError(
              `Stopped after ${BULK_MAX_CONSECUTIVE_FAILURES} failures in a row. ${
                err instanceof Error ? err.message : ""
              }`.trim(),
            );
            break;
          }
        } finally {
          setScoreProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
        }
      }
    } finally {
      setScoreProgress(null);
      await itemsQuery.refetch();
    }
  }

  // Leads on this page with no verdict yet. Drives the "Score N unscored"
  // button, so the backfill is one click rather than a selection exercise.
  const unscoredItems = allItems.filter((i) => !i.fitVerdict);

  function toggleListSelected(listId: string, index: number, shiftKey = false) {
    // Same shared helper the items table and both other tables use, so the
    // gesture is not "works on Prospects only".
    setSelectedListIds((prev) =>
      applyShiftClickSelection(lists, index, shiftKey, lastCheckedListIdRef.current, prev),
    );
    lastCheckedListIdRef.current = listId;
    // Any change invalidates a pending confirmation -- the count it named is
    // no longer the count that would be deleted.
    setConfirmDeleteLists(false);
  }

  /**
   * Deletes the selected lists.
   *
   * Loops the existing delete-lead-list action rather than adding a bulk one:
   * that action already re-checks ownership per list and cascades to its
   * items, and a new bulk endpoint would have to reimplement both. A handful
   * of sequential calls is the right trade for not duplicating a
   * destructive path.
   */
  async function handleBulkDeleteLists() {
    const ids = [...selectedListIds];
    if (ids.length === 0) return;
    setIsDeletingLists(true);
    try {
      for (const listId of ids) {
        await deleteList.mutateAsync({ listId });
      }
      // If the open list was among them, close the detail pane rather than
      // leaving it querying a list that no longer exists.
      if (selectedListId && ids.includes(selectedListId)) {
        setSelectedListId(null);
        setSelectedItemIds(new Set());
      }
      setSelectedListIds(new Set());
      setConfirmDeleteLists(false);
      await listsQuery.refetch();
    } finally {
      setIsDeletingLists(false);
    }
  }

  async function handleBulkDeleteItems() {
    const ids = [...selectedItemIds];
    if (ids.length === 0) return;
    setIsDeletingItems(true);
    try {
      await bulkDeleteItems.mutateAsync({ ids });
      setSelectedItemIds(new Set());
      setConfirmBulkDelete(false);
      // Both queries: the list's own count is shown in the sidebar too.
      await Promise.all([itemsQuery.refetch(), listsQuery.refetch()]);
    } finally {
      setIsDeletingItems(false);
    }
  }

  async function handleEnrich(item: LeadListItem) {
    setEnrichingIds((prev) => new Set(prev).add(item.id));
    try {
      await enrichItem.mutateAsync({ itemId: item.id });
    } finally {
      setEnrichingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      itemsQuery.refetch();
    }
  }

  // Anchor row (by id) for shift-click range select.
  const lastCheckedItemIdRef = useRef<string | null>(null);

  function toggleSelectItem(id: string, index: number, shiftKey: boolean) {
    setSelectedItemIds((prev) => applyShiftClickSelection(items, index, shiftKey, lastCheckedItemIdRef.current, prev));
    lastCheckedItemIdRef.current = id;
  }

  function toggleSelectAllItems() {
    const allSelected = items.length > 0 && items.every((i) => selectedItemIds.has(i.id));
    setSelectedItemIds(allSelected ? new Set() : new Set(items.map((i) => i.id)));
  }

  function selectAllAcrossList() {
    setSelectedItemIds(new Set(allItems.map((i) => i.id)));
  }

  // Sequential, not parallel -- keeps this well under the per-hour Apollo
  // rate limit and avoids hammering Apollo with a burst of concurrent calls.
  async function runBulkEnrich(targets: LeadListItem[], limit = MAX_BULK_ENRICH) {
    if (targets.length === 0) return;
    setBulkHalt(null);
    // Best-first, then truncate: if the cap discards most of a selection the
    // survivors should be the best leads, not whichever sat at the top of the
    // Sales Nav order.
    const queue = sortByQuality(targets).slice(0, limit);
    setBulkEnrichProgress({ done: 0, total: queue.length });
    let consecutiveFailures = 0;

    for (const [index, item] of queue.entries()) {
      setEnrichingIds((prev) => new Set(prev).add(item.id));
      try {
        const res = (await enrichItem.mutateAsync({ itemId: item.id })) as
          | { ok?: boolean; code?: string; error?: string }
          | undefined;
        // A budget/allowance refusal means STOP. Continuing would fire the
        // remaining calls against a closed budget and swallow every rejection,
        // which is what the old catch-and-continue did.
        if (res?.ok === false && res.code && BULK_HALT_CODES.has(res.code)) {
          setBulkHalt({
            code: res.code,
            message: describeHalt(res.code, res.error),
            done: index,
            total: queue.length,
          });
          break;
        }
        if (res?.ok === false) consecutiveFailures++;
        else consecutiveFailures = 0;
      } catch {
        // Per-item failures are surfaced via enrichmentError on that row --
        // keep going so one bad lead doesn't stop the rest of the batch.
        consecutiveFailures++;
      } finally {
        setEnrichingIds((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
        setBulkEnrichProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
      }

      // A systemic failure (Apollo down, key revoked) should not hammer
      // through the whole selection.
      if (consecutiveFailures >= BULK_MAX_CONSECUTIVE_FAILURES) {
        setBulkHalt({
          code: "repeated_failure",
          message: describeHalt("repeated_failure"),
          done: index + 1,
          total: queue.length,
        });
        break;
      }
    }
    setBulkEnrichProgress(null);
    itemsQuery.refetch();
    allItemsQuery.refetch();
  }

  function handleBulkEnrichAllEligible() {
    return runBulkEnrich(enrichEligibleItems);
  }

  async function handleBulkEnrichSelected() {
    // Source from allItems, not the current page's `items` -- a selection
    // made via "select all N leads in this list" can span pages that
    // aren't currently loaded into `items`.
    const targets = allItems.filter((i) => selectedItemIds.has(i.id));
    await runBulkEnrich(targets);
    setSelectedItemIds(new Set());
    allItemsQuery.refetch();
  }

  function handleSelectList(listId: string) {
    setSelectedListId(listId);
    setSelectedItemIds(new Set());
  }

  async function handleDeleteList(listId: string) {
    await deleteList.mutateAsync({ listId });
    if (selectedListId === listId) setSelectedListId(null);
    listsQuery.refetch();
  }

  function startRenameList(list: LeadList) {
    setRenamingListId(list.id);
    setRenameValue(list.name);
    requestAnimationFrame(() => renameInputRef.current?.focus());
  }

  function cancelRenameList() {
    setRenamingListId(null);
    setRenameValue("");
  }

  async function commitRenameList() {
    const listId = renamingListId;
    const name = renameValue.trim();
    if (!listId || !name) {
      cancelRenameList();
      return;
    }
    setRenamingListId(null);
    await renameList.mutateAsync({ listId, name });
    listsQuery.refetch();
    if (selectedListId === listId) itemsQuery.refetch();
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Left panel — lead list list */}
      <div className="w-72 shrink-0 flex flex-col border-e border-border bg-muted/20">
        <div className="border-b border-border px-4 py-3">
          {selectedListIds.size > 0 ? (
            // One row, not a stack.
            //
            // The first version put "N selected" on one line and a full-width
            // tinted destructive button on the next, so a routine selection
            // looked like a warning state and the button outweighed everything
            // around it. Delete is now a quiet icon button that only turns red
            // on hover, and the confirmation takes over the row rather than
            // adding a third line.
            <div className="flex h-7 items-center justify-between gap-2">
              {confirmDeleteLists ? (
                <>
                  <span className="min-w-0 truncate text-xs text-foreground">
                    Delete {selectedListIds.size} {selectedListIds.size === 1 ? "list" : "lists"}?
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void handleBulkDeleteLists()}
                      disabled={isDeletingLists}
                      className="inline-flex items-center gap-1 rounded-md bg-destructive px-2 py-1 text-[11px] font-medium text-white hover:bg-destructive/90 disabled:opacity-50"
                    >
                      {isDeletingLists && <IconLoader2 size={11} className="animate-spin" />}
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteLists(false)}
                      className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </span>
                </>
              ) : (
                <>
                  <span className="text-sm font-semibold">
                    {selectedListIds.size} selected
                  </span>
                  <span className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteLists(true)}
                      title={`Delete ${selectedListIds.size} ${selectedListIds.size === 1 ? "list" : "lists"}`}
                      aria-label={`Delete ${selectedListIds.size} ${selectedListIds.size === 1 ? "list" : "lists"}`}
                      className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <IconTrash size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedListIds(new Set())}
                      title="Clear selection"
                      aria-label="Clear selection"
                      className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <IconX size={14} />
                    </button>
                  </span>
                </>
              )}
            </div>
          ) : (
            // Fixed height matching the bulk row above, so the sidebar header
            // does not jump as a selection starts and ends.
            <div className="flex h-7 items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <IconUsers size={15} className="text-[#0a66c2]" />
                <span className="text-sm font-semibold">Lead Lists</span>
              </span>
              {lists.length > 1 && (
                <span className="flex items-center gap-1">
                  {/* A bare select rather than a popover: four options, no
                      state worth a custom control, and it stays keyboard- and
                      screen-reader-native for free. */}
                  <label className="sr-only" htmlFor="lead-list-sort">
                    Sort lists
                  </label>
                  <select
                    id="lead-list-sort"
                    value={listSort}
                    onChange={(e) => changeListSort(e.target.value as ListSort)}
                    title="Sort lists"
                    className="cursor-pointer rounded border border-transparent bg-transparent py-0.5 pe-1 text-xs text-muted-foreground hover:border-border hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {LIST_SORTS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedListIds(new Set(lists.map((l) => l.id)));
                      lastCheckedListIdRef.current = null;
                    }}
                    className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    Select all
                  </button>
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {listsQuery.isLoading ? (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
              <IconLoader2 size={14} className="animate-spin" />
              Loading…
            </div>
          ) : lists.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <IconListCheck size={28} className="text-muted-foreground/50" />
              <div>
                <p className="text-sm font-medium">No lead lists yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Open a Sales Navigator saved lead list and use the extension's Lists tab to import it here.
                </p>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {lists.map((l, listIndex) => (
                <li key={l.id}>
                  {renamingListId === l.id ? (
                    <div className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <input
                          ref={renameInputRef}
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRenameList();
                            if (e.key === "Escape") cancelRenameList();
                          }}
                          maxLength={120}
                          className="flex-1 min-w-0 rounded-md border border-primary/50 bg-background px-2 py-1 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        <button
                          type="button"
                          onClick={commitRenameList}
                          className="shrink-0 rounded p-1 text-emerald-600 hover:bg-emerald-500/10"
                          title="Save"
                        >
                          <IconCheck size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={cancelRenameList}
                          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted"
                          title="Cancel"
                        >
                          <IconX size={14} />
                        </button>
                      </div>
                      {l.description ? (
                        <p className="text-[11px] text-muted-foreground mt-1 truncate">{l.description}</p>
                      ) : null}
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {l.totalCount} leads
                        {formatListCreatedAt(l.createdAt) && ` · Created ${formatListCreatedAt(l.createdAt)}`}
                      </p>
                    </div>
                  ) : (
                    // A div, not a button: the row now contains a checkbox,
                    // and a button inside a button is invalid HTML with
                    // ambiguous click targets.
                    <div
                      className={cn(
                        "group flex items-start gap-2 px-4 py-3 transition-colors hover:bg-muted/50",
                        selectedListId === l.id && "bg-muted",
                        selectedListIds.has(l.id) && "bg-primary/5",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selectedListIds.has(l.id)}
                        // onClick rather than onChange: onChange's event has
                        // no shiftKey.
                        onClick={(ev) => toggleListSelected(l.id, listIndex, ev.shiftKey)}
                        onChange={() => {}}
                        aria-label={`Select ${l.name}`}
                        title="Select — shift-click to select a range"
                        className="mt-1 shrink-0 rounded border-border"
                      />
                      <button
                        type="button"
                        onClick={() => handleSelectList(l.id)}
                        onDoubleClick={() => startRenameList(l)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="text-sm font-medium truncate">{l.name}</p>
                        {l.description ? (
                          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{l.description}</p>
                        ) : null}
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {l.totalCount} leads
                          {formatListCreatedAt(l.createdAt) && ` · Created ${formatListCreatedAt(l.createdAt)}`}
                        </p>
                      </button>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => startRenameList(l)}
                          className="mt-0.5 rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground"
                          title="Rename list"
                        >
                          <IconPencil size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteList(l.id)}
                          className="mt-0.5 rounded p-1 text-muted-foreground/60 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10 hover:text-destructive"
                          title="Delete list"
                        >
                          <IconTrash size={13} />
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Right panel — lead list items */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selectedListId ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <IconListCheck size={32} className="mx-auto text-muted-foreground/40" />
              <p className="mt-3 text-sm text-muted-foreground">Select a lead list to view leads</p>
            </div>
          </div>
        ) : (
          <>
            {/* Persistent, not a toast: a bulk run can take ~100 seconds, so a
                toast would be gone before anyone read why it stopped. Before
                this, a budget refusal produced N silent no-ops and the user
                was told nothing at all. */}
            {/* Hot leads above the table, not inside it. Renders nothing
                when none qualify, so it costs no vertical space on a page of
                ordinary leads. */}
            <HotLeadsSection
              leads={allItems}
              scopeLabel="in this list"
              onGenerate={(lead) => setOutreachLead(lead)}
            />

            {scoreError && (
              <div className="flex items-start justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-6 py-2.5">
                <p className="text-xs text-amber-800 dark:text-amber-300">{scoreError}</p>
                <button
                  type="button"
                  onClick={() => setScoreError(null)}
                  className="shrink-0 text-xs text-amber-800/70 hover:text-amber-900 dark:text-amber-300/70"
                >
                  Dismiss
                </button>
              </div>
            )}

            {bulkHalt && (
              <div className="flex items-start justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-6 py-2.5">
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  <strong>
                    Stopped at {bulkHalt.done} of {bulkHalt.total}.
                  </strong>{" "}
                  {bulkHalt.message}{" "}
                  {bulkHalt.total - bulkHalt.done > 0 && (
                    <>{bulkHalt.total - bulkHalt.done} leads were not enriched.</>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => setBulkHalt(null)}
                  className="shrink-0 text-xs text-amber-800/70 hover:text-amber-900 dark:text-amber-300/70"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Header */}
            <div className="border-b border-border px-6 py-3 flex items-center justify-between">
              {selectedItemIds.size > 0 ? (
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-foreground">{selectedItemIds.size} selected</span>
                  {selectedItemIds.size < itemsTotalCount && items.every((i) => selectedItemIds.has(i.id)) && (
                    <button type="button" onClick={selectAllAcrossList}
                      className="text-xs text-primary hover:underline">
                      Select all {itemsTotalCount} leads in this list
                    </button>
                  )}
                  <button type="button" onClick={() => setSelectedItemIds(new Set())}
                    className="text-xs text-muted-foreground hover:text-foreground">Deselect all</button>
                </div>
              ) : (
                <div className="min-w-0">
                  {/* Rename from the header as well as the sidebar. Both drive
                      the same renamingListId state, so there is one rename
                      flow rather than two that could disagree. */}
                  {renamingListId && renamingListId === activeList?.id ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void commitRenameList();
                          if (e.key === "Escape") cancelRenameList();
                        }}
                        onBlur={() => void commitRenameList()}
                        className="w-64 rounded-md border border-border bg-background px-2 py-1 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <button
                        type="button"
                        onClick={() => void commitRenameList()}
                        aria-label="Save name"
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <IconCheck size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="group flex items-center gap-1.5">
                      <h2 className="truncate text-sm font-semibold">{activeList?.name ?? "Lead List"}</h2>
                      {activeList && (
                        <button
                          type="button"
                          onClick={() => startRenameList(activeList)}
                          title="Rename this list"
                          aria-label="Rename this list"
                          className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                        >
                          <IconPencil size={13} />
                        </button>
                      )}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {itemsTotalCount} lead{itemsTotalCount === 1 ? "" : "s"}
                  </p>
                </div>
              )}
              <div className="flex items-center gap-2">
                {/* Scoring sits BEFORE enrich in the toolbar because it comes
                    first in the pipeline and costs nothing -- a lead should be
                    scored before anyone decides whether it is worth a credit.
                    Shown whenever anything is unscored, regardless of whether
                    Apollo enrichment is switched on, since the two are
                    independent. */}
                {scoreProgress ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <IconLoader2 size={12} className="animate-spin" />
                    Scoring {scoreProgress.done}/{scoreProgress.total}…
                  </span>
                ) : selectedItemIds.size > 0 ? (
                  <button
                    type="button"
                    onClick={() => void runBulkScore(allItems.filter((i) => selectedItemIds.has(i.id)))}
                    title="Score fit against your ICP and draft a note. No Apollo credits."
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
                  >
                    <IconSparkles size={12} />
                    Score {Math.min(selectedItemIds.size, MAX_BULK_SCORE)}
                    {selectedItemIds.size > MAX_BULK_SCORE && ` of ${selectedItemIds.size}`}
                  </button>
                ) : unscoredItems.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => void runBulkScore(unscoredItems)}
                    title="Score fit against your ICP and draft a note. Free — no Apollo credits."
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
                  >
                    <IconSparkles size={12} />
                    Score {Math.min(unscoredItems.length, MAX_BULK_SCORE)} unscored
                    {unscoredItems.length > MAX_BULK_SCORE && ` of ${unscoredItems.length}`}
                  </button>
                ) : null}
                {bulkEnrichProgress ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <IconLoader2 size={12} className="animate-spin" />
                    Enriching {bulkEnrichProgress.done}/{bulkEnrichProgress.total}…
                  </span>
                ) : !apolloGate.enabled ? null : selectedItemIds.size > 0 ? (
                  <EnrichCostConfirm
                    selectedCount={selectedItemIds.size}
                    label={`Enrich selected (${selectedItemIds.size})`}
                    onConfirm={(limit) =>
                      runBulkEnrich(allItems.filter((i) => selectedItemIds.has(i.id)), limit)
                    }
                  />
                ) : (
                  <>
                    {/* The stellar run is PRIMARY when there is one to make.
                        This is the single highest-leverage nudge here: the
                        default action becomes "spend on the good leads"
                        rather than "spend on everything eligible". */}
                    {stellarEligibleItems.length > 0 && (
                      <EnrichCostConfirm
                        selectedCount={stellarEligibleItems.length}
                        label={`✨ Enrich stellar (${stellarEligibleItems.length})`}
                        onConfirm={(limit) => runBulkEnrich(stellarEligibleItems, limit)}
                      />
                    )}
                    {enrichEligibleItems.length > 0 && (
                      <EnrichCostConfirm
                        selectedCount={enrichEligibleItems.length}
                        label={
                          stellarEligibleItems.length > 0
                            ? `Enrich all eligible (${enrichEligibleItems.length})`
                            : `Enrich all (${enrichEligibleItems.length})`
                        }
                        onConfirm={(limit) => runBulkEnrich(enrichEligibleItems, limit)}
                      />
                    )}
                  </>
                )}
                {selectedItemIds.size > 0 ? (
                  <>
                    <button
                      type="button"
                      onClick={() => openExport(allItems.filter((i) => selectedItemIds.has(i.id)), "selected-leads")}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
                    >
                      <IconDownload size={12} />
                      Make CSV of {selectedItemIds.size} selected
                    </button>
                    {/* Bulk delete, which this page had no path to at all --
                        the action already existed but only the Prospects page
                        reached it. Two-step, because it is irreversible. */}
                    {confirmBulkDelete ? (
                      <span className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleBulkDeleteItems()}
                          disabled={isDeletingItems}
                          className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-2.5 py-1.5 text-xs font-medium text-white hover:bg-destructive/90 disabled:opacity-50"
                        >
                          {isDeletingItems ? <IconLoader2 size={12} className="animate-spin" /> : <IconTrash size={12} />}
                          Delete {selectedItemIds.size} permanently
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmBulkDelete(false)}
                          className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmBulkDelete(true)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
                      >
                        <IconTrash size={12} />
                        Delete selected
                      </button>
                    )}
                  </>
                ) : allItems.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => openExport(allItems, "lead-list")}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
                  >
                    <IconDownload size={12} />
                    Export CSV
                  </button>
                ) : null}
              </div>
            </div>

            {/* Items table */}
            <div className="flex-1 overflow-auto">
              {itemsQuery.isLoading ? (
                <div className="flex items-center gap-2 px-6 py-8 text-sm text-muted-foreground">
                  <IconLoader2 size={14} className="animate-spin" />
                  Loading leads…
                </div>
              ) : items.length === 0 ? (
                <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                  No leads in this list.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th scope="col" className="py-2.5 pl-4 pr-1 w-8">
                        <input
                          type="checkbox"
                          checked={items.length > 0 && items.every((i) => selectedItemIds.has(i.id))}
                          onChange={toggleSelectAllItems}
                          className="rounded border-border"
                          title="Select all"
                        />
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Name</th>
                      <th scope="col" className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Job Title</th>
                      <th scope="col" className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Company</th>
                      <th scope="col" className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Email</th>
                      <th scope="col" className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Phone</th>
                      <th scope="col" className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, index) => (
                      <LeadListItemRow
                        key={item.id}
                        item={item}
                        index={index}
                        isEnriching={enrichingIds.has(item.id)}
                        isChecked={selectedItemIds.has(item.id)}
                        onToggle={toggleSelectItem}
                        onOpen={handleOpenLinkedIn}
                        onEnrich={handleEnrich}
                        onRevealed={() => {
                          itemsQuery.refetch();
                          allItemsQuery.refetch();
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {itemsTotalCount > 0 && (
              <div className="flex items-center justify-end border-t border-border px-4 py-2">
                <Pagination
                  page={itemsPage}
                  pageSize={itemsPageSize}
                  totalCount={itemsTotalCount}
                  onPageChange={setItemsPage}
                  onPageSizeChange={(size) => {
                    setItemsPageSize(Math.min(size, ITEMS_PAGE_SIZE_CAP));
                    setItemsPage(1);
                  }}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Preview before the file is written, rather than after it is opened
          and found half-empty. */}
      <OutreachPanel
        open={!!outreachLead}
        onClose={() => setOutreachLead(null)}
        lead={outreachLead}
        source="lead_list_item"
      />

      <CsvExportModal
        open={!!exportRequest}
        onClose={() => setExportRequest(null)}
        rows={exportRequest?.rows ?? []}
        filenamePrefix={exportRequest?.prefix ?? "lead-list"}
        onEnrich={apolloGate.enabled ? enrichForExport : undefined}
        onRevealPhones={apolloGate.enabled ? revealPhonesForExport : undefined}
        title={
          exportRequest?.prefix === "selected-leads"
            ? `Export ${exportRequest.rows.length} selected leads`
            : `Export ${activeList?.name ?? "lead list"}`
        }
      />
    </div>
  );
}
