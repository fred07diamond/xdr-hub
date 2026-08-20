import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { IconCheck, IconExternalLink, IconListCheck, IconLoader2, IconPencil, IconSparkles, IconTrash, IconUsers, IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { APP_TITLE } from "@/lib/app-config";
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
  if (value) {
    const provenance = describeEnrichmentProvenance(kind, enrichmentSource ?? null, enrichedEmailStatus ?? null, enrichedAt ?? null);
    return (
      <span className="text-xs truncate max-w-[170px] block" title={provenance ?? undefined}>
        {value}
      </span>
    );
  }
  // Apollo's phone reveal is async (webhook-delivered) -- "requested" means
  // enrichment itself is done, but the personal number hasn't arrived yet.
  // Past PHONE_REVEAL_STALE_AFTER_MS, stop waiting and fall through to the
  // normal "no phone found" treatment below.
  if (kind === "phone" && phoneRevealStatus === "requested" && !isPhoneRevealStale(phoneRevealRequestedAt ?? null)) {
    return <span className="text-xs italic text-muted-foreground/70">Revealing…</span>;
  }
  if (isEnriching || status === "enriching") {
    return <span className="text-xs italic text-muted-foreground/70">Enriching…</span>;
  }
  // Every empty state below also doubles as its own "run enrichment" click
  // target, same action the row's Enrich button already calls.
  const emptyLabel =
    status === "not_found" ? "No contact info found"
    : status === "failed" ? "Enrichment failed"
    : status === "done" ? `No ${kind} found`
    : "—";
  const emptyClass =
    status === "failed" ? "text-xs italic text-destructive/70"
    : status === "idle" || !status ? "text-xs text-muted-foreground/50"
    : "text-xs italic text-muted-foreground/70";
  if (!onEnrich) return <span className={emptyClass}>{emptyLabel}</span>;
  return (
    <button
      type="button"
      onClick={onEnrich}
      title="Click to enrich"
      className={`${emptyClass} underline decoration-dotted underline-offset-2 hover:text-foreground`}
    >
      {emptyLabel}
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
  if (isEnriching || item.enrichmentStatus === "enriching") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <IconLoader2 size={11} className="animate-spin" />
        Enriching…
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
}: {
  item: LeadListItem;
  index: number;
  isEnriching: boolean;
  isChecked: boolean;
  onToggle: (id: string, index: number, shiftKey: boolean) => void;
  onOpen: (item: LeadListItem) => void;
  onEnrich: (item: LeadListItem) => void;
}) {
  return (
    <tr className={cn("border-b border-border last:border-b-0 transition-colors hover:bg-muted/40", isChecked && "bg-muted/60")}>
      <td className="py-3 pl-4 pr-1 w-8">
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
          <p className="text-sm font-medium">{item.name ?? "—"}</p>
          {item.personaName && item.personaColor && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shrink-0">
              <span style={{ background: item.personaColor }} className="inline-block h-1.5 w-1.5 rounded-full" />
              {item.personaName}
            </span>
          )}
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
        <EnrichedField
          value={item.enrichedPhone}
          status={item.enrichmentStatus}
          kind="phone"
          phoneRevealStatus={item.phoneRevealStatus}
          phoneRevealRequestedAt={item.phoneRevealRequestedAt}
          enrichmentSource={item.enrichmentSource}
          enrichedAt={item.enrichedAt}
          isEnriching={isEnriching}
          onEnrich={() => onEnrich(item)}
        />
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
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [renamingListId, setRenamingListId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const listsQuery = useActionQuery("list-lead-lists", {}, { refetchInterval: 30_000 });
  const lists = ((listsQuery.data as { lists?: LeadList[] } | undefined)?.lists ?? []);

  // Paginated -- a list can hold up to 500 items and this used to fetch
  // every one of them on every selection/poll. Page-number navigation
  // (25/page), not accumulating "Load more" -- switching lists resets back
  // to page 1.
  const ITEMS_PAGE_SIZE = 25;
  const [itemsPage, setItemsPage] = useState(1);

  useEffect(() => {
    setItemsPage(1);
  }, [selectedListId]);

  const itemsQuery = useActionQuery(
    "get-lead-list-items",
    { listId: selectedListId ?? "", limit: ITEMS_PAGE_SIZE, offset: (itemsPage - 1) * ITEMS_PAGE_SIZE },
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
  const enrichItem = useActionMutation("enrich-lead-list-item");

  const enrichEligibleItems = allItems.filter(
    (i) => i.enrichmentStatus === "idle" || i.enrichmentStatus === "failed" || i.enrichmentStatus === "not_found",
  );

  function handleOpenLinkedIn(item: LeadListItem) {
    window.open(linkedInUrl(item), "_blank", "noopener,noreferrer");
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
  async function runBulkEnrich(targets: LeadListItem[]) {
    if (targets.length === 0) return;
    setBulkEnrichProgress({ done: 0, total: targets.length });
    for (const item of targets) {
      setEnrichingIds((prev) => new Set(prev).add(item.id));
      try {
        await enrichItem.mutateAsync({ itemId: item.id });
      } catch {
        // Per-item failures are surfaced via enrichmentError on that row --
        // keep going so one bad lead doesn't stop the rest of the batch.
      } finally {
        setEnrichingIds((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
        setBulkEnrichProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
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
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <IconUsers size={15} className="text-[#0a66c2]" />
          <span className="text-sm font-semibold">Lead Lists</span>
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
              {lists.map((l) => (
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
                    <button
                      type="button"
                      onClick={() => handleSelectList(l.id)}
                      onDoubleClick={() => startRenameList(l)}
                      className={cn(
                        "group w-full text-left px-4 py-3 transition-colors hover:bg-muted/50",
                        selectedListId === l.id && "bg-muted",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{l.name}</p>
                          {l.description ? (
                            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{l.description}</p>
                          ) : null}
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {l.totalCount} leads
                            {formatListCreatedAt(l.createdAt) && ` · Created ${formatListCreatedAt(l.createdAt)}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); startRenameList(l); }}
                            className="mt-0.5 rounded p-1 text-muted-foreground/60 opacity-100 hover:bg-muted hover:text-foreground"
                            title="Rename list"
                          >
                            <IconPencil size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleDeleteList(l.id); }}
                            className="mt-0.5 rounded p-1 text-muted-foreground/60 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10 hover:text-destructive"
                            title="Delete list"
                          >
                            <IconTrash size={13} />
                          </button>
                        </div>
                      </div>
                    </button>
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
                <div>
                  <h2 className="text-sm font-semibold">{activeList?.name ?? "Lead List"}</h2>
                  <p className="text-xs text-muted-foreground">
                    {itemsTotalCount} lead{itemsTotalCount === 1 ? "" : "s"}
                  </p>
                </div>
              )}
              {bulkEnrichProgress ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <IconLoader2 size={12} className="animate-spin" />
                  Enriching {bulkEnrichProgress.done}/{bulkEnrichProgress.total}…
                </span>
              ) : selectedItemIds.size > 0 ? (
                <button
                  type="button"
                  onClick={handleBulkEnrichSelected}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  <IconSparkles size={12} />
                  Enrich selected ({selectedItemIds.size})
                </button>
              ) : enrichEligibleItems.length > 0 ? (
                <button
                  type="button"
                  onClick={handleBulkEnrichAllEligible}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  <IconSparkles size={12} />
                  Enrich all ({enrichEligibleItems.length})
                </button>
              ) : null}
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
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {itemsTotalCount > 0 && (
              <div className="flex items-center justify-end border-t border-border px-4 py-2">
                <Pagination page={itemsPage} pageSize={ITEMS_PAGE_SIZE} totalCount={itemsTotalCount} onPageChange={setItemsPage} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
