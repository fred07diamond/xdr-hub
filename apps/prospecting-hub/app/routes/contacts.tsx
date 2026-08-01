import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";
import {
  IconBrandLinkedin,
  IconChevronLeft,
  IconChevronRight,
  IconExternalLink,
  IconLoader2,
  IconSearch,
  IconUsers,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";

import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `${APP_TITLE} — Contacts` }];
}

const PAGE_SIZE = 50;

interface ContactRow {
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

function scoreBadge(score: number | null) {
  if (score == null) {
    return { label: "—", className: "bg-muted text-muted-foreground" };
  }
  if (score >= 80) {
    return { label: `Excellent · ${score}`, className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" };
  }
  if (score >= 50) {
    return { label: `Good · ${score}`, className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" };
  }
  return { label: `Weak · ${score}`, className: "bg-muted text-muted-foreground" };
}

function ScorePill({ score, size = "sm" }: { score: number | null; size?: "sm" | "lg" }) {
  const badge = scoreBadge(score);
  const sizeClass = size === "lg" ? "px-2.5 py-1 text-sm" : "px-2 py-0.5 text-xs";
  return (
    <span className={`inline-flex items-center rounded-full font-medium ${sizeClass} ${badge.className}`}>
      {badge.label}
    </span>
  );
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

export default function ContactsRoute() {
  const [search, setSearch] = useState("");
  const [personaId, setPersonaId] = useState("");
  const [source, setSource] = useState<"" | ContactRow["source"]>("");
  const [status, setStatus] = useState<"" | ContactRow["status"]>("");
  const [offset, setOffset] = useState(0);
  const [actioningId, setActioningId] = useState<string | null>(null);

  const { data: personasData } = useActionQuery("list-personas", {});
  const personaOptions: PersonaOption[] = (personasData as { personas?: PersonaOption[] })?.personas ?? [];

  const queryArgs = useMemo(
    () => ({
      search: search.trim() || undefined,
      personaId: personaId || undefined,
      source: source || undefined,
      status: status || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    [search, personaId, source, status, offset],
  );

  const { data, isLoading, refetch } = useActionQuery("list-contacts", queryArgs, {
    refetchInterval: 30000,
    staleTime: 25000,
  });

  const markActioned = useActionMutation("mark-contact-actioned");

  const contacts: ContactRow[] = (data as { contacts?: ContactRow[] })?.contacts ?? [];
  const total = (data as { total?: number })?.total ?? 0;
  const hasMore = (data as { hasMore?: boolean })?.hasMore ?? false;

  function resetToFirstPage() {
    setOffset(0);
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

  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + contacts.length, total);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold text-foreground">Contacts</h1>
          <p className="text-xs text-muted-foreground">
            {isLoading ? "Loading…" : total === 0 ? "No contacts synced yet" : `${total.toLocaleString()} contact${total === 1 ? "" : "s"} across HubSpot and CommonRoom`}
          </p>
        </div>
      </div>

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
        <select
          value={personaId}
          onChange={(e) => { setPersonaId(e.target.value); resetToFirstPage(); }}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All personas</option>
          {personaOptions.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select
          value={source}
          onChange={(e) => { setSource(e.target.value as "" | ContactRow["source"]); resetToFirstPage(); }}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All sources</option>
          <option value="hubspot">HubSpot</option>
          <option value="commonroom">CommonRoom</option>
          <option value="prospector">Prospector</option>
        </select>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value as "" | ContactRow["status"]); resetToFirstPage(); }}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="actioned">Actioned</option>
        </select>
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
              <p className="mt-1 text-xs text-muted-foreground/60">Sync from HubSpot or CommonRoom, or adjust the filters above.</p>
            </div>
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 border-b border-border bg-background text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-4 py-2 font-medium">Persona</th>
                <th className="px-4 py-2 font-medium">Overall Score</th>
                <th className="px-4 py-2 font-medium">Persona Match</th>
                <th className="px-4 py-2 font-medium">Company Fit</th>
                <th className="px-4 py-2 font-medium">Engagement</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Segments</th>
                <th className="px-4 py-2 font-medium">Synced</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {contacts.map((c) => (
                <tr key={c.id} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-foreground">{c.name}</p>
                    {c.title && <p className="text-muted-foreground/70">{c.title}</p>}
                  </td>
                  <td className="px-4 py-2.5 text-foreground">{c.company ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    {c.personaName ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="size-2 shrink-0 rounded-full" style={{ background: c.personaColor ?? "#94a3b8" }} />
                        {c.personaName}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50">Unscored</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5"><ScorePill score={c.overallScore} size="lg" /></td>
                  <td className="px-4 py-2.5"><ScorePill score={c.personaMatchScore} /></td>
                  <td className="px-4 py-2.5"><ScorePill score={c.companyFitScore} /></td>
                  <td className="px-4 py-2.5"><ScorePill score={c.engagementScore} /></td>
                  <td className="px-4 py-2.5 capitalize text-muted-foreground">{c.source}</td>
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
                  <td className="px-4 py-2.5">
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
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
          <span>{rangeStart}-{rangeEnd} of {total.toLocaleString()}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              disabled={offset === 0}
              className="rounded p-1 hover:bg-muted disabled:opacity-30"
            >
              <IconChevronLeft size={14} />
            </button>
            <button
              type="button"
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              disabled={!hasMore}
              className="rounded p-1 hover:bg-muted disabled:opacity-30"
            >
              <IconChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
