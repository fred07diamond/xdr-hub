import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import {
  IconPlugConnected,
  IconExternalLink,
  IconListCheck,
  IconLoader2,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { APP_TITLE } from "@/lib/app-config";
import { cn } from "@/lib/utils";

type HubSpotList = { id: string; name: string; size: number };

type QueueItem = {
  id: string;
  queueId: string;
  hubspotContactId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  company: string | null;
  jobTitle: string | null;
  linkedinUrl: string | null;
  status: "pending" | "visited" | "skipped";
  position: number;
};

type Queue = {
  id: string;
  name: string;
  hubspotListName: string;
  status: "active" | "done";
  totalCount: number;
};

type StatusFilter = "all" | "pending" | "visited" | "skipped";

function linkedInUrl(item: QueueItem): string {
  if (item.linkedinUrl) return item.linkedinUrl;
  const parts = [item.firstName, item.lastName, item.company].filter(Boolean);
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(parts.join(" "))}`;
}

function StatusPill({ status }: { status: QueueItem["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
        status === "pending" && "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
        status === "visited" && "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
        status === "skipped" && "bg-muted text-muted-foreground line-through",
      )}
    >
      {status}
    </span>
  );
}

function NewQueueDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (queueId: string) => void;
}) {
  const listsQuery = useActionQuery("list-hubspot-lists", {}, { enabled: open });
  const lists = ((listsQuery.data as { lists?: HubSpotList[] } | undefined)?.lists ?? []);
  const importQueue = useActionMutation("import-hubspot-queue");

  const [selectedListId, setSelectedListId] = useState("");
  const [customName, setCustomName] = useState("");

  const selectedList = lists.find((l) => l.id === selectedListId);

  async function handleImport() {
    if (!selectedList) return;
    const result = await importQueue.mutateAsync({
      listId: selectedList.id,
      listName: selectedList.name,
      name: customName.trim() || undefined,
    }) as { queueId?: string; error?: string; truncated?: boolean };
    if (result.queueId) {
      if (result.truncated) {
        toast.warning("First 100 contacts imported — HubSpot lists larger than 100 are capped at this limit.");
      }
      setSelectedListId("");
      setCustomName("");
      onCreated(result.queueId);
      onClose();
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold">New Outreach Queue</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Import a HubSpot contact list as a LinkedIn outreach queue.
          </p>
        </div>
        <div className="space-y-4 p-5">
          {/* List picker */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">HubSpot list</label>
            {listsQuery.isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <IconLoader2 size={13} className="animate-spin" />
                Loading lists…
              </div>
            ) : listsQuery.isError ? (
              <p className="text-xs text-destructive">
                {(listsQuery.error as Error)?.message ?? "Failed to load lists"}. Check your HubSpot token in Settings.
              </p>
            ) : (listsQuery.data as { error?: string } | undefined)?.error ? (
              <p className="text-xs text-destructive">
                {(listsQuery.data as { error?: string }).error}
              </p>
            ) : lists.length === 0 ? (
              <p className="text-xs text-destructive">
                {(listsQuery.data as { error?: string } | undefined)?.error
                  ?? `No contact lists found. Your Private App token likely needs the crm.lists.read scope — add it in HubSpot → Settings → Private Apps.`}
              </p>
            ) : (
              <select
                value={selectedListId}
                onChange={(e) => setSelectedListId(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">Choose a list…</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.size} contacts)
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Optional name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">
              Queue name <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder={selectedList?.name ?? "e.g. VP Sales Q3"}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {importQueue.isError && (
            <p className="text-xs text-destructive">
              {(importQueue.error as Error)?.message ?? "Import failed"}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={!selectedListId || importQueue.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {importQueue.isPending && <IconLoader2 size={12} className="animate-spin" />}
            {importQueue.isPending ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}

function QueueItemRow({
  item,
  onOpen,
  onSkip,
  onUnskip,
}: {
  item: QueueItem;
  onOpen: (item: QueueItem) => void;
  onSkip: (item: QueueItem) => void;
  onUnskip: (item: QueueItem) => void;
}) {
  const fullName = [item.firstName, item.lastName].filter(Boolean).join(" ") || "—";

  return (
    <tr
      className={cn(
        "border-b border-border last:border-b-0 transition-colors hover:bg-muted/40",
        item.status === "skipped" && "opacity-40",
      )}
    >
      <td className="px-4 py-3">
        <p className="text-sm font-medium">{fullName}</p>
        {item.email && (
          <p className="text-[11px] text-muted-foreground truncate max-w-[180px]">{item.email}</p>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{item.jobTitle ?? "—"}</td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{item.company ?? "—"}</td>
      <td className="px-4 py-3">
        <StatusPill status={item.status} />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          {item.status !== "skipped" ? (
            <>
              <button
                type="button"
                onClick={() => onOpen(item)}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted"
              >
                <IconExternalLink size={11} />
                LinkedIn
              </button>
              <button
                type="button"
                onClick={() => onSkip(item)}
                className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
              >
                Skip
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => onUnskip(item)}
              className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
            >
              Restore
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export function meta() {
  return [{ title: `Queue - ${APP_TITLE}` }];
}

export default function QueuePage() {
  useSetPageTitle("Queue");

  const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const queuesQuery = useActionQuery("list-queues", {}, { refetchInterval: 30_000 });
  const queues = ((queuesQuery.data as { queues?: Queue[] } | undefined)?.queues ?? []);

  const itemsQuery = useActionQuery(
    "get-queue-items",
    { queueId: selectedQueueId ?? "" },
    { enabled: !!selectedQueueId, refetchInterval: 5_000 },
  );
  const items: QueueItem[] = (itemsQuery.data as { items?: QueueItem[] } | undefined)?.items ?? [];
  const activeQueue = (itemsQuery.data as { queue?: Queue } | undefined)?.queue ?? null;

  const updateItem = useActionMutation("update-queue-item");
  const deleteQueue = useActionMutation("delete-queue");

  const filteredItems = statusFilter === "all"
    ? items
    : items.filter((i) => i.status === statusFilter);

  const pendingCount = items.filter((i) => i.status === "pending").length;
  const visitedCount = items.filter((i) => i.status === "visited").length;
  const skippedCount = items.filter((i) => i.status === "skipped").length;

  function handleOpenLinkedIn(item: QueueItem) {
    window.open(linkedInUrl(item), "_blank", "noopener,noreferrer");
    if (item.status === "pending") {
      updateItem.mutate({ itemId: item.id, status: "visited" });
    }
  }

  function handleSkip(item: QueueItem) {
    updateItem.mutate({ itemId: item.id, status: "skipped" });
  }

  function handleUnskip(item: QueueItem) {
    updateItem.mutate({ itemId: item.id, status: "pending" });
  }

  async function handleDeleteQueue(queueId: string) {
    await deleteQueue.mutateAsync({ queueId });
    if (selectedQueueId === queueId) setSelectedQueueId(null);
    queuesQuery.refetch();
  }

  const filterTabs: { id: StatusFilter; label: string }[] = [
    { id: "all", label: `All (${items.length})` },
    { id: "pending", label: `Pending (${pendingCount})` },
    { id: "visited", label: `Visited (${visitedCount})` },
    { id: "skipped", label: `Skipped (${skippedCount})` },
  ];

  return (
    <div className="flex h-full min-h-0">
      {/* Left panel — queue list */}
      <div className="w-72 shrink-0 flex flex-col border-e border-border bg-muted/20">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <IconPlugConnected size={15} className="text-[#ff7a59]" />
            <span className="text-sm font-semibold">Queues</span>
          </div>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
          >
            <IconPlus size={12} />
            New
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {queuesQuery.isLoading ? (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
              <IconLoader2 size={14} className="animate-spin" />
              Loading…
            </div>
          ) : queues.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <IconListCheck size={28} className="text-muted-foreground/50" />
              <div>
                <p className="text-sm font-medium">No queues yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Click "New" to import a HubSpot contact list.
                </p>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {queues.map((q) => (
                <li key={q.id}>
                  <button
                    type="button"
                    onClick={() => { setSelectedQueueId(q.id); setStatusFilter("all"); }}
                    className={cn(
                      "group w-full text-left px-4 py-3 transition-colors hover:bg-muted/50",
                      selectedQueueId === q.id && "bg-muted",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{q.name}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{q.hubspotListName}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{q.totalCount} contacts</p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDeleteQueue(q.id); }}
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

      {/* Right panel — queue items */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selectedQueueId ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <IconListCheck size={32} className="mx-auto text-muted-foreground/40" />
              <p className="mt-3 text-sm text-muted-foreground">Select a queue to view contacts</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="border-b border-border px-6 py-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">{activeQueue?.name ?? "Queue"}</h2>
                <p className="text-xs text-muted-foreground">
                  {pendingCount} pending · {visitedCount} visited · {skippedCount} skipped
                </p>
              </div>
            </div>

            {/* Filter tabs */}
            <div className="flex items-center gap-1 border-b border-border px-6 py-2">
              {filterTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs transition-colors",
                    statusFilter === tab.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Items table */}
            <div className="flex-1 overflow-auto">
              {itemsQuery.isLoading ? (
                <div className="flex items-center gap-2 px-6 py-8 text-sm text-muted-foreground">
                  <IconLoader2 size={14} className="animate-spin" />
                  Loading contacts…
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                  No contacts in this view.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Name</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Title</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Company</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Status</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((item) => (
                      <QueueItemRow
                        key={item.id}
                        item={item}
                        onOpen={handleOpenLinkedIn}
                        onSkip={handleSkip}
                        onUnskip={handleUnskip}
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>

      <NewQueueDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={(queueId) => {
          queuesQuery.refetch();
          setSelectedQueueId(queueId);
        }}
      />
    </div>
  );
}
