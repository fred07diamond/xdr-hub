// apps/outreach/app/routes/engagement.tsx
import { useActionQuery } from "@agent-native/core/client";
import {
  IconActivity,
  IconBrandLinkedin,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconLoader2,
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

const VERDICT_STYLES: Record<NonNullable<Verdict>, string> = {
  strong: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  possible: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  weak: "bg-rose-500/15 text-rose-500 dark:text-rose-400",
  inconclusive: "bg-muted text-muted-foreground",
};

const STATUS_LABELS: Record<EngagerStatus, string> = {
  pending: "Pending",
  enriching: "Enriching…",
  scoring: "Scoring…",
  done: "Done",
};

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  if (!verdict) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${VERDICT_STYLES[verdict]}`}>
      {verdict}
    </span>
  );
}

function PersonaBadge({ name, color }: { name: string | null; color: string | null }) {
  if (!name) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-white"
      style={{ backgroundColor: color ?? "#6366f1" }}
    >
      {name}
    </span>
  );
}

function OwnerCell({ xdrOwner, contactOwner, companyOwner }: {
  xdrOwner: string | null;
  contactOwner: string | null;
  companyOwner: string | null;
}) {
  if (xdrOwner) return (
    <div className="text-xs">
      <span className="font-medium">{xdrOwner}</span>
      <span className="ml-1 text-muted-foreground">XDR</span>
    </div>
  );
  if (contactOwner) return (
    <div className="text-xs">
      <span className="font-medium">{contactOwner}</span>
      <span className="ml-1 text-muted-foreground">Contact</span>
    </div>
  );
  if (companyOwner) return (
    <div className="text-xs">
      <span className="font-medium">{companyOwner}</span>
      <span className="ml-1 text-muted-foreground">Company</span>
    </div>
  );
  return <span className="text-xs text-muted-foreground">—</span>;
}

function HubspotCell({ status, contactUrl }: { status: HubspotStatus; contactUrl: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;

  const label = status === "new_opportunity" ? "New opportunity" : "In HubSpot";
  const badgeClass = status === "new_opportunity"
    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
    : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";

  const badge = (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}>
      {label}
      {contactUrl && <IconExternalLink className="size-3" />}
    </span>
  );

  if (contactUrl) {
    return (
      <a href={contactUrl} target="_blank" rel="noopener noreferrer" className="hover:opacity-75 transition-opacity">
        {badge}
      </a>
    );
  }
  return badge;
}

function DraftCell({ draftNote }: { draftNote: string | null }) {
  const [copied, setCopied] = useState(false);

  if (!draftNote) return <span className="text-xs text-muted-foreground">—</span>;

  const copy = () => {
    navigator.clipboard.writeText(draftNote).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-[220px]">
      <p className="line-clamp-3 text-xs text-foreground">{draftNote}</p>
      <button
        type="button"
        onClick={copy}
        className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        {copied ? <IconCheck className="size-3" /> : <IconCopy className="size-3" />}
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}

export default function EngagementRoute() {
  const [selectedPostUrl, setSelectedPostUrl] = useState<string | null>(null);

  // Poll while any engager is still processing.
  const { data, isLoading } = useActionQuery("list-post-engagements", {}, {
    refetchInterval: (query) => {
      const engagements: Engager[] = (query.state.data as any)?.engagements ?? [];
      const hasInProgress = engagements.some(e => e.status !== "done");
      return hasInProgress ? 3000 : false;
    },
  });

  const engagements: Engager[] = (data as any)?.engagements ?? [];

  // Deduplicate posts for the sidebar.
  const posts = useMemo(() => {
    const map = new Map<string, { postUrl: string; postTitle: string | null; count: number }>();
    for (const e of engagements) {
      const existing = map.get(e.postUrl);
      if (existing) {
        existing.count++;
      } else {
        map.set(e.postUrl, { postUrl: e.postUrl, postTitle: e.postTitle, count: 1 });
      }
    }
    return Array.from(map.values());
  }, [engagements]);

  const filtered = selectedPostUrl
    ? engagements.filter(e => e.postUrl === selectedPostUrl)
    : engagements;

  return (
    <div className="flex h-full min-h-0">
      {/* Posts sidebar */}
      <aside className="w-60 shrink-0 overflow-y-auto border-e border-border bg-muted/30 px-3 py-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Posts</p>
        <button
          type="button"
          onClick={() => setSelectedPostUrl(null)}
          className={`mb-1 w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors ${!selectedPostUrl ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"}`}
        >
          All posts ({engagements.length})
        </button>
        {posts.map(post => (
          <button
            key={post.postUrl}
            type="button"
            onClick={() => setSelectedPostUrl(post.postUrl)}
            className={`mb-1 w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors ${selectedPostUrl === post.postUrl ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"}`}
          >
            <span className="block truncate">{post.postTitle || post.postUrl}</span>
            <span className="text-xs text-muted-foreground">{post.count} engager{post.count !== 1 ? "s" : ""}</span>
          </button>
        ))}
        {!posts.length && !isLoading && (
          <p className="mt-4 text-xs text-muted-foreground">
            Open a LinkedIn post and load commenters from the Builder.LI extension.
          </p>
        )}
      </aside>

      {/* Main engager table */}
      <main className="flex-1 overflow-auto p-6">
        <div className="mb-4 flex items-center gap-2">
          <IconActivity className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Engagement</h1>
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <IconLoader2 className="size-4 animate-spin" />
            Loading…
          </div>
        )}

        {!isLoading && !filtered.length && (
          <p className="text-sm text-muted-foreground">
            No engagers yet.{" "}
            {selectedPostUrl ? "Select a different post or " : ""}
            Open a LinkedIn post and use the Engagers tab in the extension to load commenters.
          </p>
        )}

        {filtered.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Person</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Company</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Comment</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Owner</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">HubSpot</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Persona</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Fit</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Draft note</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e, i) => (
                  <tr key={e.id} className={`border-b border-border last:border-0 ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                    {/* Person */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <a
                          href={e.engagerProfileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium hover:underline"
                        >
                          {e.engagerName}
                        </a>
                        <IconBrandLinkedin className="size-3.5 shrink-0 text-[#0a66c2]" />
                      </div>
                      {e.engagerHeadline && (
                        <div className="mt-0.5 max-w-[180px] truncate text-xs text-muted-foreground">
                          {e.engagerHeadline}
                        </div>
                      )}
                    </td>

                    {/* Company */}
                    <td className="px-4 py-3">
                      <span className="text-sm">{e.engagerCompany || <span className="text-xs text-muted-foreground">—</span>}</span>
                    </td>

                    {/* Comment */}
                    <td className="max-w-[160px] px-4 py-3">
                      <p className="line-clamp-2 text-xs text-muted-foreground">{e.commentText || "—"}</p>
                    </td>

                    {/* Owner */}
                    <td className="px-4 py-3">
                      <OwnerCell xdrOwner={e.xdrOwner} contactOwner={e.contactOwner} companyOwner={e.companyOwner} />
                    </td>

                    {/* HubSpot */}
                    <td className="px-4 py-3">
                      <HubspotCell status={e.hubspotStatus} contactUrl={e.hubspotContactUrl} />
                    </td>

                    {/* Persona */}
                    <td className="px-4 py-3">
                      <PersonaBadge name={e.personaName} color={e.personaColor} />
                    </td>

                    {/* Fit */}
                    <td className="px-4 py-3">
                      <VerdictBadge verdict={e.fitVerdict} />
                      {e.fitReason && (
                        <p className="mt-1 max-w-[200px] text-xs text-muted-foreground">{e.fitReason}</p>
                      )}
                    </td>

                    {/* Draft note */}
                    <td className="px-4 py-3">
                      <DraftCell draftNote={e.draftNote} />
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`text-xs ${e.status === "done" ? "text-emerald-600" : "text-muted-foreground"}`}>
                        {e.status !== "done" && <IconLoader2 className="mr-1 inline size-3 animate-spin" />}
                        {STATUS_LABELS[e.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
