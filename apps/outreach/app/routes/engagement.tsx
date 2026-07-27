// apps/outreach/app/routes/engagement.tsx
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import {
  IconActivity,
  IconBrandLinkedin,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconLoader2,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";

import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `${APP_TITLE} — Engagement` }];
}

type HubspotStatus = "found" | "new_opportunity" | null;
type Verdict = "strong" | "possible" | "weak" | "inconclusive" | null;
type EngagerStatus = "pending" | "enriching" | "scoring" | "done";

interface Engager {
  id: string;
  postUrl: string;
  postTitle: string | null;
  engagerName: string;
  engagerHeadline: string | null;
  engagerCompany: string | null;
  engagerProfileUrl: string;
  commentText: string | null;
  xdrOwner: string | null;
  contactOwner: string | null;
  companyOwner: string | null;
  hubspotStatus: HubspotStatus;
  hubspotContactUrl: string | null;
  fitVerdict: Verdict;
  fitReason: string | null;
  draftNote: string | null;
  personaId: string | null;
  personaName: string | null;
  personaColor: string | null;
  status: EngagerStatus;
  createdAt: string | null;
}

// ── small reusable pieces ──────────────────────────────────────────────────────

const VERDICT_STYLES: Record<NonNullable<Verdict>, { bg: string; text: string }> = {
  strong:       { bg: "bg-emerald-500/12", text: "text-emerald-700 dark:text-emerald-400" },
  possible:     { bg: "bg-amber-500/12",   text: "text-amber-700 dark:text-amber-400"   },
  weak:         { bg: "bg-rose-500/12",    text: "text-rose-600 dark:text-rose-400"     },
  inconclusive: { bg: "bg-muted",          text: "text-muted-foreground"                },
};

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  if (!verdict) return null;
  const { bg, text } = VERDICT_STYLES[verdict];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${bg} ${text}`}>
      {verdict}
    </span>
  );
}

function PersonaBadge({ name, color }: { name: string | null; color: string | null }) {
  if (!name) return null;
  return (
    <span
      className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white"
      style={{ backgroundColor: color ?? "#6366f1" }}
    >
      {name}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="mt-1.5 inline-flex items-center gap-1 rounded text-xs text-primary hover:underline"
    >
      {copied ? <IconCheck className="size-3" /> : <IconCopy className="size-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ── table rows ─────────────────────────────────────────────────────────────────

function PersonCell({ e }: { e: Engager }) {
  return (
    <td className="px-4 py-3 align-top">
      <div className="flex items-start gap-1.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <a
              href={e.engagerProfileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold leading-snug hover:underline"
            >
              {e.engagerName}
            </a>
            <IconBrandLinkedin className="size-3.5 shrink-0 text-[#0a66c2]" />
          </div>
          {(e.engagerCompany || e.engagerHeadline) && (
            <p className="mt-0.5 max-w-[200px] truncate text-xs text-muted-foreground">
              {e.engagerCompany || e.engagerHeadline}
            </p>
          )}
          {e.commentText && (
            <p className="mt-1 max-w-[200px] line-clamp-2 text-[11px] italic text-muted-foreground/70">
              "{e.commentText}"
            </p>
          )}
          {e.personaName && (
            <div className="mt-1.5">
              <PersonaBadge name={e.personaName} color={e.personaColor} />
            </div>
          )}
        </div>
      </div>
    </td>
  );
}

function FitCell({ e }: { e: Engager }) {
  return (
    <td className="px-4 py-3 align-top">
      {e.fitVerdict ? (
        <>
          <VerdictBadge verdict={e.fitVerdict} />
          {e.fitReason && (
            <p className="mt-1.5 max-w-[220px] text-xs leading-relaxed text-muted-foreground">
              {e.fitReason}
            </p>
          )}
        </>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      )}
    </td>
  );
}

function HubspotOwnerCell({ e }: { e: Engager }) {
  const owner = e.xdrOwner || e.contactOwner || e.companyOwner;
  const ownerLabel = e.xdrOwner ? "XDR" : e.contactOwner ? "Contact" : e.companyOwner ? "Company" : null;

  if (!e.hubspotStatus) {
    return <td className="px-4 py-3 align-top"><span className="text-xs text-muted-foreground">—</span></td>;
  }

  const isFound = e.hubspotStatus === "found";
  const badgeClass = isFound
    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
    : "bg-amber-500/12 text-amber-700 dark:text-amber-400";
  const label = isFound ? "In HubSpot" : "New opportunity";

  const badge = (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}>
      {label}
      {e.hubspotContactUrl && <IconExternalLink className="size-2.5" />}
    </span>
  );

  return (
    <td className="px-4 py-3 align-top">
      {e.hubspotContactUrl ? (
        <a href={e.hubspotContactUrl} target="_blank" rel="noopener noreferrer" className="hover:opacity-75 transition-opacity">
          {badge}
        </a>
      ) : badge}
      {owner && ownerLabel && (
        <p className="mt-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{owner}</span>
          <span className="ml-1 text-[10px] uppercase tracking-wide opacity-60">{ownerLabel}</span>
        </p>
      )}
    </td>
  );
}

function DraftCell({ e }: { e: Engager }) {
  if (!e.draftNote) {
    return (
      <td className="px-4 py-3 align-top">
        <span className="text-xs text-muted-foreground">
          {e.status !== "done" ? "Drafting…" : "—"}
        </span>
      </td>
    );
  }
  return (
    <td className="px-4 py-3 align-top">
      <p className="max-w-[260px] text-xs leading-relaxed line-clamp-4">{e.draftNote}</p>
      <CopyButton text={e.draftNote} />
    </td>
  );
}

function StatusCell({ e }: { e: Engager }) {
  if (e.status === "done") return <td className="px-4 py-3 align-top" />;
  const label = e.status === "enriching" ? "Enriching" : e.status === "scoring" ? "Scoring" : "Pending";
  return (
    <td className="px-4 py-3 align-top">
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <IconLoader2 className="size-3 animate-spin" />
        {label}
      </span>
    </td>
  );
}

// ── page ───────────────────────────────────────────────────────────────────────

export default function EngagementRoute() {
  const [selectedPostUrl, setSelectedPostUrl] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirmDelete, setBulkConfirmDelete] = useState(false);

  const { data, isLoading, refetch } = useActionQuery("list-post-engagements", {}, {
    refetchInterval: (query) => {
      const engagements: Engager[] = (query.state.data as any)?.engagements ?? [];
      return engagements.some(e => e.status !== "done") ? 3000 : false;
    },
  });

  const bulkDelete = useActionMutation("bulk-delete-post-engagements");

  const engagements: Engager[] = (data as any)?.engagements ?? [];

  const posts = useMemo(() => {
    const map = new Map<string, { postUrl: string; postTitle: string | null; count: number }>();
    for (const e of engagements) {
      const existing = map.get(e.postUrl);
      if (existing) existing.count++;
      else map.set(e.postUrl, { postUrl: e.postUrl, postTitle: e.postTitle, count: 1 });
    }
    return Array.from(map.values());
  }, [engagements]);

  const filtered = selectedPostUrl
    ? engagements.filter(e => e.postUrl === selectedPostUrl)
    : engagements;

  const allFilteredSelected = filtered.length > 0 && filtered.every(e => selectedIds.has(e.id));
  const someSelected = selectedIds.size > 0;

  function toggleOne(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allFilteredSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        filtered.forEach(e => next.delete(e.id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        filtered.forEach(e => next.add(e.id));
        return next;
      });
    }
  }

  async function handleBulkDelete() {
    await bulkDelete.mutateAsync({ ids: Array.from(selectedIds) });
    setSelectedIds(new Set());
    setBulkConfirmDelete(false);
    refetch();
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 overflow-y-auto border-e border-border bg-muted/30 px-3 py-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Posts</p>
        <button
          type="button"
          onClick={() => setSelectedPostUrl(null)}
          className={`mb-1 w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors ${!selectedPostUrl ? "bg-accent text-accent-foreground font-medium" : "hover:bg-accent/60"}`}
        >
          All posts
          <span className="ml-1 text-xs text-muted-foreground">({engagements.length})</span>
        </button>
        {posts.map(post => (
          <button
            key={post.postUrl}
            type="button"
            onClick={() => setSelectedPostUrl(post.postUrl)}
            className={`mb-1 w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors ${selectedPostUrl === post.postUrl ? "bg-accent text-accent-foreground font-medium" : "hover:bg-accent/60"}`}
          >
            <span className="block truncate">{post.postTitle || post.postUrl}</span>
            <span className="text-xs text-muted-foreground">{post.count} engager{post.count !== 1 ? "s" : ""}</span>
          </button>
        ))}
        {!posts.length && !isLoading && (
          <p className="mt-4 text-xs text-muted-foreground leading-relaxed">
            Open a LinkedIn post and load commenters from the Builder.LI extension.
          </p>
        )}
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6">
        <div className="mb-5 flex items-center gap-2">
          <IconActivity className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Engagement</h1>
          {filtered.length > 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {filtered.length}
            </span>
          )}
        </div>

        {/* Bulk action bar */}
        {someSelected && (
          <div className="mb-4 flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-4 py-2.5">
            <span className="text-sm font-semibold">{selectedIds.size} selected</span>
            <button
              type="button"
              onClick={() => { setSelectedIds(new Set()); setBulkConfirmDelete(false); }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Deselect all
            </button>
            <div className="ml-auto flex items-center gap-2">
              {bulkConfirmDelete ? (
                <>
                  <span className="text-xs text-muted-foreground">Delete {selectedIds.size} engager{selectedIds.size !== 1 ? "s" : ""}?</span>
                  <button
                    type="button"
                    onClick={handleBulkDelete}
                    disabled={bulkDelete.isPending}
                    className="rounded bg-destructive px-2.5 py-1 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                  >
                    {bulkDelete.isPending ? "Deleting…" : "Confirm"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkConfirmDelete(false)}
                    className="rounded p-1 text-muted-foreground hover:bg-muted"
                  >
                    <IconX className="size-3.5" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setBulkConfirmDelete(true)}
                  className="inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <IconTrash className="size-3.5" />
                  Delete
                </button>
              )}
            </div>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <IconLoader2 className="size-4 animate-spin" />
            Loading…
          </div>
        )}

        {!isLoading && !filtered.length && (
          <p className="text-sm text-muted-foreground">
            No engagers yet.{selectedPostUrl ? " Select a different post or open" : " Open"} a LinkedIn post and use the Engagers tab in the extension to load commenters.
          </p>
        )}

        {filtered.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleAll}
                      className="rounded border-border"
                      title={allFilteredSelected ? "Deselect all" : "Select all"}
                    />
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Person</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fit</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">HubSpot</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Draft note</th>
                  <th className="w-[1%] px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => {
                  const isChecked = selectedIds.has(e.id);
                  return (
                    <tr
                      key={e.id}
                      className={`border-b border-border/60 last:border-0 transition-colors ${isChecked ? "bg-accent/30" : "hover:bg-muted/20"}`}
                    >
                      <td className="w-10 px-3 py-3 align-top">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleOne(e.id)}
                          className="rounded border-border"
                        />
                      </td>
                      <PersonCell e={e} />
                      <FitCell e={e} />
                      <HubspotOwnerCell e={e} />
                      <DraftCell e={e} />
                      <StatusCell e={e} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
