import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { IconExternalLink, IconListCheck, IconLoader2, IconSparkles, IconTrash, IconUsers } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { APP_TITLE } from "@/lib/app-config";
import { cn } from "@/lib/utils";
import { Pagination } from "@/components/Pagination";
import { MasterProspectsTable } from "@/components/MasterProspectsTable";

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
  enrichmentError: string | null;
  phoneRevealStatus: "requested" | "done" | "no_match" | "failed" | null;
  phoneRevealRequestedAt: string | null;
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

type LeadList = {
  id: string;
  name: string;
  description: string | null;
  salesNavListUrl: string | null;
  totalCount: number;
  createdAt: string | null;
};

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
}: {
  value: string | null;
  status: LeadListItem["enrichmentStatus"];
  kind: "email" | "phone";
  phoneRevealStatus?: LeadListItem["phoneRevealStatus"];
  phoneRevealRequestedAt?: LeadListItem["phoneRevealRequestedAt"];
}) {
  if (value) return <span className="text-xs truncate max-w-[170px] block">{value}</span>;
  // Apollo's phone reveal is async (webhook-delivered) -- "requested" means
  // enrichment itself is done, but the personal number hasn't arrived yet.
  // Past PHONE_REVEAL_STALE_AFTER_MS, stop waiting and fall through to the
  // normal "no phone found" treatment below.
  if (kind === "phone" && phoneRevealStatus === "requested" && !isPhoneRevealStale(phoneRevealRequestedAt ?? null)) {
    return <span className="text-xs italic text-muted-foreground/70">Revealing…</span>;
  }
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
  isEnriching,
  isChecked,
  onToggle,
  onOpen,
  onEnrich,
}: {
  item: LeadListItem;
  isEnriching: boolean;
  isChecked: boolean;
  onToggle: (id: string) => void;
  onOpen: (item: LeadListItem) => void;
  onEnrich: (item: LeadListItem) => void;
}) {
  return (
    <tr className={cn("border-b border-border last:border-b-0 transition-colors hover:bg-muted/40", isChecked && "bg-muted/60")}>
      <td className="py-3 pl-4 pr-1 w-8">
        <input
          type="checkbox"
          checked={isChecked}
          onChange={() => onToggle(item.id)}
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
        </div>
        {item.location && (
          <p className="text-[11px] text-muted-foreground truncate max-w-[180px]">{item.location}</p>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{item.headline ?? "—"}</td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{item.company ?? "—"}</td>
      <td className="px-4 py-3">
        <EnrichedField value={item.enrichedEmail} status={item.enrichmentStatus} kind="email" />
      </td>
      <td className="px-4 py-3">
        <EnrichedField value={item.enrichedPhone} status={item.enrichmentStatus} kind="phone" phoneRevealStatus={item.phoneRevealStatus} phoneRevealRequestedAt={item.phoneRevealRequestedAt} />
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

  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set());
  const [bulkEnrichProgress, setBulkEnrichProgress] = useState<{ done: number; total: number } | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

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

  const deleteList = useActionMutation("delete-lead-list");
  const enrichItem = useActionMutation("enrich-lead-list-item");

  const enrichEligibleCount = items.filter(
    (i) => i.enrichmentStatus === "idle" || i.enrichmentStatus === "failed" || i.enrichmentStatus === "not_found",
  ).length;

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

  function toggleSelectItem(id: string) {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAllItems() {
    const allSelected = items.length > 0 && items.every((i) => selectedItemIds.has(i.id));
    setSelectedItemIds(allSelected ? new Set() : new Set(items.map((i) => i.id)));
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
  }

  function handleBulkEnrichAllEligible() {
    return runBulkEnrich(items.filter(
      (i) => i.enrichmentStatus === "idle" || i.enrichmentStatus === "failed" || i.enrichmentStatus === "not_found",
    ));
  }

  async function handleBulkEnrichSelected() {
    const targets = items.filter((i) => selectedItemIds.has(i.id));
    await runBulkEnrich(targets);
    setSelectedItemIds(new Set());
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
                  <button
                    type="button"
                    onClick={() => handleSelectList(l.id)}
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
                        <p className="text-[11px] text-muted-foreground mt-0.5">{l.totalCount} leads</p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDeleteList(l.id); }}
                        className="mt-0.5 shrink-0 rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-opacity"
                      >
                        <IconTrash size={13} />
                      </button>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Right panel — lead list items */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selectedListId ? (
          <MasterProspectsTable />
        ) : (
          <>
            {/* Header */}
            <div className="border-b border-border px-6 py-3 flex items-center justify-between">
              {selectedItemIds.size > 0 ? (
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-foreground">{selectedItemIds.size} selected</span>
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
              ) : enrichEligibleCount > 0 ? (
                <button
                  type="button"
                  onClick={handleBulkEnrichAllEligible}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  <IconSparkles size={12} />
                  Enrich all ({enrichEligibleCount})
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
                      <th className="py-2.5 pl-4 pr-1 w-8">
                        <input
                          type="checkbox"
                          checked={items.length > 0 && items.every((i) => selectedItemIds.has(i.id))}
                          onChange={toggleSelectAllItems}
                          className="rounded border-border"
                          title="Select all"
                        />
                      </th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Name</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Job Title</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Company</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Email</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Phone</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <LeadListItemRow
                        key={item.id}
                        item={item}
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
