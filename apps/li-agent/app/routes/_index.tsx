import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import {
  IconBrandLinkedin,
  IconBriefcase,
  IconBuilding,
  IconCheck,
  IconChevronDown,
  IconClipboard,
  IconCoin,
  IconDownload,
  IconExternalLink,
  IconLayoutColumns,
  IconListCheck,
  IconLoader2,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSparkles,
  IconTag,
  IconThumbDown,
  IconThumbUp,
  IconTrash,
  IconUsers,
  IconX,
} from "@tabler/icons-react";

import { buildMasterCsv } from "@/lib/prospects-csv";
import { applyShiftClickSelection } from "@/lib/selection";

// Prospects table columns a user can hide -- Person and Actions are load-
// bearing (selection + row identity, primary actions) and stay put.
const PROSPECT_HIDEABLE_COLUMNS: { key: string; label: string }[] = [
  { key: "company", label: "Company" },
  { key: "persona", label: "Persona" },
  { key: "jobTitle", label: "Job Title" },
  { key: "fit", label: "Fit" },
  { key: "tags", label: "Tags" },
  { key: "draftNote", label: "Draft note" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
];
const PROSPECT_HIDDEN_COLUMNS_STORAGE_KEY = "li-agent-prospects-hidden-columns";

function HubSpotIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#ff7a59" />
      <text x="16" y="21" textAnchor="middle" fill="white" fontSize="16" fontWeight="700" fontFamily="sans-serif">H</text>
    </svg>
  );
}
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Pagination } from "@/components/Pagination";
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

interface Tag {
  id: string;
  name: string;
  color: string;
  prospectCount?: number;
}

interface Prospect {
  id: string;
  // The real, unprefixed prospects.id or leadListItems.id -- what per-row
  // mutations (enrich/rate/note/delete/mark-sent/add-to-list) must target.
  // `id` is prefixed ("prospect:"/"lead_list:") only to keep the two id
  // namespaces from colliding as merged React list keys.
  rawId: string;
  source: "prospect" | "lead_list";
  profileUrl: string | null;
  salesNavLeadUrl: string | null;
  listName: string | null;
  location: string | null;
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
  // null for lead_list-sourced rows -- not yet visited, no status lifecycle
  // has started for them.
  status: Status | null;
  // Always empty for lead_list-sourced rows -- tags are prospects-only, same
  // scope as rating/note (see AGENTS.md's Lead Lists section).
  tags: Tag[];
  enrichmentStatus: "idle" | "enriching" | "done" | "not_found" | "failed";
  enrichedEmail: string | null;
  enrichedTitle: string | null;
  enrichedPhone: string | null;
  enrichedLinkedinUrl: string | null;
  enrichedCompanyIndustry: string | null;
  enrichedCompanySize: number | null;
  companyDomain: string | null;
  enrichedAt: string | null;
  enrichmentError: string | null;
  // Provenance -- which write path produced the current enrichment values
  // ("apollo" | "apollo_phone_reveal"), and Apollo's own confidence in the
  // matched email ("verified" | "guessed" | "unavailable", straight from
  // Apollo's person.email_status).
  enrichmentSource: string | null;
  enrichedEmailStatus: string | null;
  phoneRevealStatus: "requested" | "done" | "no_match" | "failed" | null;
  phoneRevealRequestedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

function linkedInHref(p: Prospect): string {
  if (p.profileUrl) return p.profileUrl;
  if (p.enrichedLinkedinUrl) return p.enrichedLinkedinUrl;
  if (p.salesNavLeadUrl) return p.salesNavLeadUrl;
  const parts = [p.name, p.company].filter(Boolean);
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(parts.join(" "))}`;
}

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

const VERDICT_STYLES: Record<NonNullable<Verdict>, string> = {
  strong: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  possible: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  weak: "bg-rose-500/15 text-rose-500 dark:text-rose-400",
};

// Same swatch set as ICP Personas (app/routes/icp.tsx) for visual consistency
// across the app's two "user creates a named, colored thing" features. Tag
// color is cosmetic only (just tints the chip) -- there's no manual picker,
// a new tag just gets a random one of these assigned.
const TAG_COLORS = ["#6366f1", "#f97316", "#22c55e", "#ec4899", "#0ea5e9", "#eab308", "#a855f7", "#ef4444"];
function randomTagColor(): string {
  return TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
}

// Company logo/avatar + HubSpot hover card ─────────────────────────────────

// Same lettered-avatar hash used in booking/meetings.tsx and settings.tsx,
// keyed by company name instead of a person's email.
const COMPANY_AVATAR_COLORS = ["bg-indigo-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-sky-500", "bg-violet-500"];
function companyAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return COMPANY_AVATAR_COLORS[Math.abs(hash) % COMPANY_AVATAR_COLORS.length];
}

const COMPANY_SUFFIX_RE = /\s*[,]?\s*\b(inc\.?|llc\.?|ltd\.?|corp\.?|corporation|company|co\.?|gmbh|plc)\b\.?\s*$/i;

// companyDomain only backfills once a prospect is re-enriched (see
// CLAUDE.md), so most existing rows have none yet. Guessing a plausible
// domain from the company name lets the logo work today for common
// companies instead of every pre-existing row showing only the letter
// fallback -- worst case a wrong guess just 404s and CompanyLogo falls
// back to the same lettered avatar it would have shown anyway.
function guessCompanyDomain(name: string): string | null {
  const cleaned = name
    .replace(/\([^)]*\)/g, "")
    .replace(COMPANY_SUFFIX_RE, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return cleaned ? `${cleaned}.com` : null;
}

// Clearbit's free public logo API keyed by domain -- HubSpot has no logo
// field at all, this is the standard non-HubSpot trick for "give me a logo
// for this domain." Falls back to a lettered avatar when there's no domain
// or the image 404s.
function CompanyLogo({ name, domain }: { name: string | null; domain: string | null }) {
  const [imgFailed, setImgFailed] = useState(false);
  const effectiveDomain = domain ?? (name ? guessCompanyDomain(name) : null);
  if (effectiveDomain && !imgFailed) {
    return (
      <img
        src={`https://logo.clearbit.com/${effectiveDomain}`}
        onError={() => setImgFailed(true)}
        alt=""
        className="h-5 w-5 shrink-0 rounded-sm bg-white object-contain ring-1 ring-black/5"
      />
    );
  }
  const label = (name ?? "?").trim();
  return (
    <div className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-[10px] font-semibold text-white", companyAvatarColor(label))}>
      {(label[0] ?? "?").toUpperCase()}
    </div>
  );
}

function formatDealAmount(amount: string | null): string | null {
  if (!amount) return null;
  const n = Number(amount);
  if (Number.isNaN(n)) return null;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

interface HubSpotCompanyData {
  connected: boolean;
  matched: boolean;
  recordUrl?: string | null;
  company?: {
    name: string | null;
    domain: string | null;
    industry: string | null;
    employeeCount: string | null;
    country: string | null;
    companyOwnerName: string | null;
    xdrOwnerName: string | null;
  } | null;
  openDeals?: Array<{ name: string; amount: string | null; closeDate: string | null }>;
  closedLostDeals?: Array<{ name: string; amount: string | null; closeDate: string | null }>;
  topProspects?: Array<{ name: string; title: string | null; email: string | null; lastActivityAt: string | null }>;
}

function formatRelativeActivity(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (Number.isNaN(days) || days < 0) return null;
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

// Shared by the hover card (top few items) and ProspectSheet's Company
// section (full lists) -- same action/params means react-query dedupes if
// the row was already hovered before being clicked.
function useHubSpotCompany(companyDomain: string | null, companyName: string | null, enabled: boolean) {
  return useActionQuery<HubSpotCompanyData>(
    "get-hubspot-company",
    { companyDomain, companyName },
    { enabled: enabled && !!(companyDomain || companyName) },
  );
}

function CompanyHoverCardBody({ data, isLoading }: { data: HubSpotCompanyData | undefined; isLoading: boolean }) {
  if (isLoading) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <IconLoader2 size={12} className="animate-spin" /> Loading HubSpot data…
      </p>
    );
  }
  if (!data?.connected) return <p className="text-xs text-muted-foreground">HubSpot not connected.</p>;
  if (!data.matched || !data.company) return <p className="text-xs text-muted-foreground">Not found in HubSpot.</p>;

  const { company, openDeals = [], closedLostDeals = [], topProspects = [] } = data;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <CompanyLogo name={company.name} domain={company.domain} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{company.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {[company.industry, company.employeeCount ? `${company.employeeCount} employees` : null].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <p className="flex items-center gap-1 text-muted-foreground">
            <IconBriefcase size={10} /> Company owner
          </p>
          <p className={cn("truncate", company.companyOwnerName ? "text-foreground" : "text-muted-foreground/60")}>
            {company.companyOwnerName ?? "—"}
          </p>
        </div>
        <div>
          <p className="flex items-center gap-1 text-muted-foreground">
            <IconBriefcase size={10} /> xDR owner
          </p>
          <p className={cn("truncate", company.xdrOwnerName ? "text-foreground" : "text-muted-foreground/60")}>
            {company.xdrOwnerName ?? "—"}
          </p>
        </div>
      </div>

      <div>
        <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <IconCoin size={11} /> Open deals
        </p>
        {openDeals.length === 0 ? (
          <p className="text-xs italic text-muted-foreground/70">No open deals.</p>
        ) : (
          <ul className="space-y-0.5">
            {openDeals.slice(0, 3).map((d, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-foreground">{d.name || "Untitled deal"}</span>
                <span className="shrink-0 text-muted-foreground">{formatDealAmount(d.amount) ?? ""}</span>
              </li>
            ))}
            {openDeals.length > 3 && <li className="text-[11px] text-muted-foreground/70">+{openDeals.length - 3} more</li>}
          </ul>
        )}
      </div>

      <div>
        <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <IconCoin size={11} /> Closed lost
        </p>
        {closedLostDeals.length === 0 ? (
          <p className="text-xs italic text-muted-foreground/70">No closed-lost deals.</p>
        ) : (
          <ul className="space-y-0.5">
            {closedLostDeals.slice(0, 3).map((d, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-foreground">{d.name || "Untitled deal"}</span>
                <span className="shrink-0 text-muted-foreground">{formatDealAmount(d.amount) ?? ""}</span>
              </li>
            ))}
            {closedLostDeals.length > 3 && <li className="text-[11px] text-muted-foreground/70">+{closedLostDeals.length - 3} more</li>}
          </ul>
        )}
      </div>

      <div>
        <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <IconUsers size={11} /> Top prospects by activity
        </p>
        {topProspects.length === 0 ? (
          <p className="text-xs italic text-muted-foreground/70">No other contacts on record.</p>
        ) : (
          <ul className="space-y-0.5">
            {topProspects.slice(0, 3).map((c, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-foreground">{c.name}</span>
                <span className="shrink-0 text-muted-foreground">{formatRelativeActivity(c.lastActivityAt) ?? ""}</span>
              </li>
            ))}
            {topProspects.length > 3 && <li className="text-[11px] text-muted-foreground/70">+{topProspects.length - 3} more</li>}
          </ul>
        )}
      </div>

      {data.recordUrl && (
        <a href={data.recordUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
          View in HubSpot <IconExternalLink size={10} />
        </a>
      )}
    </div>
  );
}

function CompanyCell({ company, companyDomain }: { company: string | null; companyDomain: string | null }) {
  const [open, setOpen] = useState(false);
  const query = useHubSpotCompany(companyDomain, company, open);

  if (!company) return <span className="text-xs text-muted-foreground">—</span>;

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={300}>
      <HoverCardTrigger asChild>
        <button type="button" className="flex max-w-[180px] items-center gap-1.5 text-left">
          <CompanyLogo name={company} domain={companyDomain} />
          <span className="truncate text-xs text-muted-foreground underline decoration-dotted decoration-muted-foreground/50 underline-offset-2">
            {company}
          </span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-72" onClick={(e) => e.stopPropagation()}>
        <CompanyHoverCardBody data={query.data as HubSpotCompanyData | undefined} isLoading={query.isLoading} />
      </HoverCardContent>
    </HoverCard>
  );
}

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  if (!verdict) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${VERDICT_STYLES[verdict]}`}>
      {verdict}
    </span>
  );
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
  status: Prospect["enrichmentStatus"];
  kind: "email" | "phone";
  phoneRevealStatus?: Prospect["phoneRevealStatus"];
  phoneRevealRequestedAt?: Prospect["phoneRevealRequestedAt"];
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
  // Every empty state below is also its own "run enrichment" affordance, not
  // just a dead end -- clicking it calls the same enrich action as the
  // Actions-column button, so the empty cell doubles as the click target.
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

function ScoreDraftButton({
  prospect,
  isScoring,
  error,
  onScore,
}: {
  prospect: Prospect;
  isScoring: boolean;
  error?: string;
  onScore: (prospect: Prospect) => void;
}) {
  if (isScoring) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <IconLoader2 size={11} className="animate-spin" />
        Scoring…
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onScore(prospect); }}
      title={error ?? "Generate a fit score and draft note for this lead"}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] hover:bg-muted ${
        error ? "border-destructive/40 text-destructive" : "border-border"
      }`}
    >
      <IconSparkles size={11} />
      Score &amp; Draft
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
  const isProspect = prospect.source === "prospect";
  const markSent = useActionMutation("mark-sent");
  const updateNote = useActionMutation("update-prospect-note");
  const deleteProspect = useActionMutation("delete-prospect");
  const rateProspect = useActionMutation("rate-prospect");
  const redraft = useActionMutation("redraft-prospect");
  const enrichProspect = useActionMutation("enrich-prospect");
  const enrichLeadListItem = useActionMutation("enrich-lead-list-item");
  const scoreLeadListItem = useActionMutation("score-lead-list-item");
  const [isEnriching, setIsEnriching] = useState(false);
  const [isScoring, setIsScoring] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);

  const tagsQuery = useActionQuery("list-prospect-tags", {});
  const allTags: Tag[] = ((tagsQuery.data as { tags?: Tag[] } | undefined)?.tags ?? []);
  const createTag = useActionMutation("create-prospect-tag");
  const updateTag = useActionMutation("update-prospect-tag");
  const deleteTag = useActionMutation("delete-prospect-tag");
  const setProspectTags = useActionMutation("set-prospect-tags");

  async function handleToggleTag(tagId: string) {
    const nextIds = new Set(prospect.tags.map((t) => t.id));
    nextIds.has(tagId) ? nextIds.delete(tagId) : nextIds.add(tagId);
    await setProspectTags.mutateAsync({ prospectId: prospect.rawId, tagIds: [...nextIds] });
    onUpdated();
  }

  async function handleCreateTag(name: string, color: string) {
    const result = await createTag.mutateAsync({ name, color });
    tagsQuery.refetch();
    return result as { ok: boolean; error?: string };
  }

  async function handleRenameTag(id: string, name: string) {
    await updateTag.mutateAsync({ id, name });
    tagsQuery.refetch();
  }

  async function handleDeleteTag(id: string) {
    await deleteTag.mutateAsync({ id });
    tagsQuery.refetch();
    onUpdated();
  }

  const crmQuery = useActionQuery(
    "check-hubspot-contact",
    { profileUrl: prospect.profileUrl ?? "" },
    { enabled: !!prospect.profileUrl },
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

  // Company-level HubSpot data (deals + other contacts at this company) --
  // same action the Prospects table's Company hover card uses, so react-
  // query's cache is shared if this row was already hovered before being
  // clicked into.
  const companyQuery = useHubSpotCompany(prospect.companyDomain, prospect.company, true);
  const companyData = companyQuery.data as HubSpotCompanyData | undefined;

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
    await updateNote.mutateAsync({ id: prospect.rawId, draftNote: note, draftFollowUp: followUp || null });
    setNoteDirty(false);
    onUpdated();
  }

  async function handleMarkSent() {
    if (!prospect.profileUrl) return;
    await markSent.mutateAsync({ profileUrl: prospect.profileUrl });
    onUpdated();
  }

  async function handleRedraft() {
    const result = await redraft.mutateAsync({ id: prospect.rawId });
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
    await rateProspect.mutateAsync({ id: prospect.rawId, rating: newRating ?? value, ratingNote: note });
    setRating(newRating);
    if (newRating === -1) setShowRatingNote(true);
    else setShowRatingNote(false);
    onUpdated();
  }

  async function handleRatingNoteBlur() {
    if (rating === -1 && ratingNote.trim()) {
      await rateProspect.mutateAsync({ id: prospect.rawId, rating: -1, ratingNote: ratingNote.trim() });
      onUpdated();
    }
  }

  async function handleDelete() {
    await deleteProspect.mutateAsync({ id: prospect.rawId });
    onClose();
    onDeleted();
  }

  async function handleEnrichFromSheet() {
    setIsEnriching(true);
    try {
      if (isProspect) await enrichProspect.mutateAsync({ id: prospect.rawId });
      else await enrichLeadListItem.mutateAsync({ itemId: prospect.rawId });
    } finally {
      setIsEnriching(false);
      onUpdated();
    }
  }

  async function handleScoreDraft() {
    setIsScoring(true);
    setScoreError(null);
    try {
      const result = await scoreLeadListItem.mutateAsync({ itemId: prospect.rawId });
      if (result?.error) {
        setScoreError(result.error);
        return;
      }
      // The row's identity changes (lead_list:<id> -> prospect:<newId>) in
      // the merged view once this lands -- close the sheet and let the
      // parent's refetch pick up the newly-promoted row.
      onClose();
      onUpdated();
    } catch (err) {
      setScoreError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsScoring(false);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent showClose={false} className="flex w-full flex-col gap-0 p-0 sm:max-w-lg overflow-hidden">
        <SheetHeader className="border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="flex items-center gap-1.5 text-sm font-semibold">
                <a href={linkedInHref(prospect)} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 hover:text-primary hover:underline">
                  <IconBrandLinkedin size={15} className="shrink-0 text-[#0077B5]" />
                  {prospect.name ?? prospect.profileUrl ?? "Open LinkedIn"}
                </a>
              </SheetTitle>
              {(prospect.role || prospect.company || prospect.listName) && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {[prospect.role, prospect.company].filter(Boolean).join(" · ")}
                  {!isProspect && prospect.listName && ` · from "${prospect.listName}"`}
                </p>
              )}
            </div>
            <button type="button" onClick={onClose} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted">
              <IconX size={16} />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <VerdictBadge verdict={prospect.fitVerdict} />
            {isProspect && (
              <TagPickerCell
                prospect={prospect}
                allTags={allTags}
                onToggleTag={handleToggleTag}
                onCreateTag={handleCreateTag}
                onRenameTag={handleRenameTag}
                onDeleteTag={handleDeleteTag}
              />
            )}
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
          {isProspect && (
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
          )}
          {isProspect && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Follow-up (after they accept)</p>
              <textarea value={followUp} onChange={(e) => { setFollowUp(e.target.value); setNoteDirty(true); }} rows={3}
                placeholder="No follow-up drafted"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50" />
              {followUp && <div className="mt-1 flex justify-end"><CopyButton text={followUp} label="Copy follow-up" /></div>}
            </div>
          )}

          {!isProspect && (
            <div className="space-y-2">
              <p className="text-xs italic text-muted-foreground">
                Not visited yet -- no fit scoring or draft note exists until the profile is opened in LinkedIn.
              </p>
              <button
                type="button"
                onClick={handleScoreDraft}
                disabled={isScoring}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                {isScoring ? <IconLoader2 size={12} className="animate-spin" /> : <IconSparkles size={13} />}
                Score &amp; Draft
              </button>
              {scoreError && <p className="text-xs text-destructive">{scoreError}</p>}
            </div>
          )}

          {isProspect && (
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
          )}

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
                    <span className="flex min-w-0 items-center justify-end gap-1.5">
                      {row.label === "Email" && row.value && prospect.enrichedEmailStatus && (
                        <span
                          className={cn(
                            "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                            prospect.enrichedEmailStatus === "verified"
                              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                              : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                          )}
                        >
                          {prospect.enrichedEmailStatus}
                        </span>
                      )}
                      <span className={cn("truncate text-xs text-right", row.value ? "text-foreground" : "text-muted-foreground/60")}>
                        {row.value ?? "—"}
                      </span>
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
            {prospect.enrichmentStatus === "done" && prospect.enrichmentSource && (
              <p className="mt-1.5 text-[11px] text-muted-foreground/70">
                {prospect.enrichmentSource === "apollo_phone_reveal" ? "Via Apollo phone reveal" : "Via Apollo"}
                {prospect.enrichedAt && !Number.isNaN(new Date(prospect.enrichedAt).getTime())
                  ? ` · enriched ${new Date(prospect.enrichedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                  : ""}
              </p>
            )}
          </div>

          {(prospect.companyDomain || prospect.company) && (
            <div className="pt-4 border-t border-border">
              <div className="mb-2 flex items-center gap-1.5">
                <IconBuilding size={12} className="text-muted-foreground" />
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Company</p>
              </div>
              {companyQuery.isLoading ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <IconLoader2 size={12} className="animate-spin" /> Loading HubSpot data…
                </p>
              ) : !companyData?.connected ? (
                <p className="text-xs text-muted-foreground">HubSpot not connected.</p>
              ) : !companyData.matched || !companyData.company ? (
                <p className="text-xs italic text-muted-foreground">Not found in HubSpot.</p>
              ) : (
                <div className="space-y-3">
                  <div className="overflow-hidden rounded-lg border border-border divide-y divide-border bg-muted/20">
                    {[
                      { label: "Industry", value: companyData.company.industry },
                      { label: "Employees", value: companyData.company.employeeCount },
                      { label: "Country", value: companyData.company.country },
                      { label: "Company owner", value: companyData.company.companyOwnerName },
                      { label: "xDR owner", value: companyData.company.xdrOwnerName },
                    ].map((row) => (
                      <div key={row.label} className="flex items-center justify-between gap-3 px-3 py-2">
                        <span className="shrink-0 text-[11px] text-muted-foreground">{row.label}</span>
                        <span className={cn("truncate text-xs text-right", row.value ? "text-foreground" : "text-muted-foreground/60")}>
                          {row.value ?? "—"}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div>
                    <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <IconCoin size={11} /> Open deals
                    </p>
                    {(companyData.openDeals ?? []).length === 0 ? (
                      <p className="text-xs italic text-muted-foreground/70">No open deals.</p>
                    ) : (
                      <div className="overflow-hidden rounded-lg border border-border divide-y divide-border bg-muted/20">
                        {(companyData.openDeals ?? []).map((d, i) => (
                          <div key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                            <span className="truncate text-xs text-foreground">{d.name || "Untitled deal"}</span>
                            <span className="shrink-0 text-right text-xs text-muted-foreground">{formatDealAmount(d.amount) ?? ""}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <IconCoin size={11} /> Closed lost deals
                    </p>
                    {(companyData.closedLostDeals ?? []).length === 0 ? (
                      <p className="text-xs italic text-muted-foreground/70">No closed-lost deals.</p>
                    ) : (
                      <div className="overflow-hidden rounded-lg border border-border divide-y divide-border bg-muted/20">
                        {(companyData.closedLostDeals ?? []).map((d, i) => (
                          <div key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                            <span className="truncate text-xs text-foreground">{d.name || "Untitled deal"}</span>
                            <span className="shrink-0 text-right text-xs text-muted-foreground">{formatDealAmount(d.amount) ?? ""}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <IconUsers size={11} /> Top prospects by activity
                    </p>
                    {(companyData.topProspects ?? []).length === 0 ? (
                      <p className="text-xs italic text-muted-foreground/70">No other contacts on record.</p>
                    ) : (
                      <div className="overflow-hidden rounded-lg border border-border divide-y divide-border bg-muted/20">
                        {(companyData.topProspects ?? []).map((c, i) => (
                          <div key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                            <span className="truncate text-xs text-foreground">{c.name}</span>
                            <span className="shrink-0 truncate max-w-[140px] text-right text-xs text-muted-foreground">
                              {[c.title, formatRelativeActivity(c.lastActivityAt)].filter(Boolean).join(" · ")}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {companyData.recordUrl && (
                    <a href={companyData.recordUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                      View in HubSpot <IconExternalLink size={10} />
                    </a>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {isProspect && (
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
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Route ────────────────────────────────────────────────────────────────────

export default function ProspectsRoute() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirmDelete, setBulkConfirmDelete] = useState(false);

  // Filters -- encoded into the URL (q/fit/tags/tagMode/persona/recency) so a
  // filtered view can be shared in Slack or bookmarked, not just held in
  // component state. Lazy-initialized from whatever's already in the URL on
  // first render (e.g. a shared link), then kept in sync by the effect below.
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [verdictFilter, setVerdictFilter] = useState<NonNullable<Verdict> | "all">(
    () => (searchParams.get("fit") as NonNullable<Verdict> | "all") ?? "all",
  );
  const [tagFilterIds, setTagFilterIds] = useState<Set<string>>(
    () => new Set(searchParams.get("tags")?.split(",").filter(Boolean) ?? []),
  );
  const [tagFilterMode, setTagFilterMode] = useState<"any" | "all">(
    () => (searchParams.get("tagMode") === "all" ? "all" : "any"),
  );
  const [personaFilter, setPersonaFilter] = useState<string>(() => searchParams.get("persona") ?? "all");
  const [recencyFilter, setRecencyFilter] = useState<"all" | "today" | "week">(
    () => (searchParams.get("recency") as "all" | "today" | "week") ?? "all",
  );

  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const setOrDelete = (key: string, value: string, defaultValue: string) =>
          value && value !== defaultValue ? next.set(key, value) : next.delete(key);
        setOrDelete("q", search, "");
        setOrDelete("fit", verdictFilter, "all");
        if (tagFilterIds.size > 0) next.set("tags", [...tagFilterIds].join(","));
        else next.delete("tags");
        setOrDelete("tagMode", tagFilterMode, "any");
        setOrDelete("persona", personaFilter, "all");
        setOrDelete("recency", recencyFilter, "all");
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, verdictFilter, tagFilterIds, tagFilterMode, personaFilter, recencyFilter]);

  // Column visibility -- a per-browser display preference, not shareable
  // state, so localStorage rather than the URL (matches the sidebar-collapse
  // pattern in components/layout/Layout.tsx). Starts with everything visible
  // and hydrates from storage after mount to avoid an SSR/client mismatch.
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(PROSPECT_HIDDEN_COLUMNS_STORAGE_KEY);
      if (stored) setHiddenColumns(new Set(JSON.parse(stored)));
    } catch {
      // Ignore storage access errors; all columns stay visible.
    }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(PROSPECT_HIDDEN_COLUMNS_STORAGE_KEY, JSON.stringify([...hiddenColumns]));
    } catch {
      // Ignore storage access errors.
    }
  }, [hiddenColumns]);
  function toggleColumn(key: string) {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set());
  const [bulkEnrichProgress, setBulkEnrichProgress] = useState<{ done: number; total: number } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [scoringIds, setScoringIds] = useState<Set<string>>(new Set());
  const [scoringErrors, setScoringErrors] = useState<Map<string, string>>(new Map());
  const [bulkScoreDraftProgress, setBulkScoreDraftProgress] = useState<{ done: number; total: number } | null>(null);

  const bulkDeleteProspects = useActionMutation("bulk-delete-prospects");
  const bulkDeleteLeadListItems = useActionMutation("bulk-delete-lead-list-items");
  const deleteProspect = useActionMutation("delete-prospect");
  const markSent = useActionMutation("mark-sent");
  const enrichProspect = useActionMutation("enrich-prospect");
  const enrichLeadListItem = useActionMutation("enrich-lead-list-item");
  const scoreLeadListItem = useActionMutation("score-lead-list-item");

  const tagsQuery = useActionQuery("list-prospect-tags", {});
  const allTags: Tag[] = ((tagsQuery.data as { tags?: Tag[] } | undefined)?.tags ?? []);
  const createTag = useActionMutation("create-prospect-tag");
  const updateTag = useActionMutation("update-prospect-tag");
  const deleteTag = useActionMutation("delete-prospect-tag");
  const setProspectTags = useActionMutation("set-prospect-tags");
  const bulkTagProspects = useActionMutation("bulk-tag-prospects");

  // Merges the prospects table with every Lead List's items, deduped
  // (list-all-prospects.ts), so this one table is "everything ever
  // captured," not just profile-visit prospects. Fetches everything in one
  // shot (real scale today is a few hundred rows, well under this cap) and
  // does filtering + pagination entirely client-side -- filters/search must
  // apply across ALL prospects, not just whatever page happens to be
  // loaded, and there's no server-side filter param to push this down to.
  // If this ever grows past the cap, this needs real server-side
  // filtering/pagination instead.
  const PROSPECTS_PAGE_SIZE = 25;
  const PROSPECTS_FETCH_LIMIT = 5000;
  const [prospectsPage, setProspectsPage] = useState(1);

  const { data, refetch, isLoading, isFetching } = useActionQuery(
    "list-all-prospects",
    { limit: PROSPECTS_FETCH_LIMIT, offset: 0 },
    {
      refetchInterval: (query) => {
        const rows = (query.state.data as any)?.rows as any[] | undefined;
        return rows?.some((p) => p.status === "captured") ? 5000 : 30000;
      },
      refetchIntervalInBackground: false,
      staleTime: 4000,
    },
  );

  const allProspects: Prospect[] = (data as any)?.rows ?? [];
  const prospectsTotalCount: number = (data as any)?.totalCount ?? 0;

  // Reset to page 1 whenever a filter changes so switching filters doesn't
  // leave you on a stale, now-out-of-range page.
  useEffect(() => {
    setProspectsPage(1);
    setIsAllMatchingSelected(false);
  }, [verdictFilter, tagFilterIds, tagFilterMode, personaFilter, recencyFilter, search]);

  // Derived persona list for filter chips
  const personas = useMemo(() => [...new Map(
    allProspects
      .filter((p) => p.personaName && p.personaColor)
      .map((p) => [p.personaName!, { name: p.personaName!, color: p.personaColor! }])
  ).values()], [allProspects]);

  function matchesCurrentFilters(p: Prospect): boolean {
    if (verdictFilter !== "all" && p.fitVerdict !== verdictFilter) return false;
    if (tagFilterIds.size > 0) {
      const prospectTagIds = new Set(p.tags.map((t) => t.id));
      const matches = tagFilterMode === "any"
        ? [...tagFilterIds].some((id) => prospectTagIds.has(id))
        : [...tagFilterIds].every((id) => prospectTagIds.has(id));
      if (!matches) return false;
    }
    if (personaFilter !== "all" && p.personaName !== personaFilter) return false;
    if (recencyFilter !== "all") {
      if (!p.createdAt) return false;
      const createdAt = new Date(p.createdAt).getTime();
      const now = Date.now();
      if (recencyFilter === "today") {
        const d = new Date(p.createdAt);
        const n = new Date();
        if (d.getFullYear() !== n.getFullYear() || d.getMonth() !== n.getMonth() || d.getDate() !== n.getDate()) return false;
      } else if (recencyFilter === "week") {
        if (now - createdAt > 7 * 24 * 60 * 60 * 1000) return false;
      }
    }
    if (search) {
      const q = search.toLowerCase();
      const haystack = [p.name, p.company, p.role, p.headline].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  }

  // Every prospect matching the active filters, across ALL pages -- not
  // just whatever page is currently displayed.
  const filtered = useMemo(
    () => allProspects.filter(matchesCurrentFilters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allProspects, verdictFilter, tagFilterIds, tagFilterMode, personaFilter, recencyFilter, search],
  );

  // What's actually rendered in the table -- one page's worth of the
  // filtered set.
  const pageRows = useMemo(
    () => filtered.slice((prospectsPage - 1) * PROSPECTS_PAGE_SIZE, prospectsPage * PROSPECTS_PAGE_SIZE),
    [filtered, prospectsPage],
  );

  // Whether every row on the CURRENT page is selected (header checkbox) --
  // separate from "select all matching", which expands the selection to
  // everything in `filtered`, across every page.
  const [isAllMatchingSelected, setIsAllMatchingSelected] = useState(false);

  const selected = allProspects.find((p) => p.id === selectedId) ?? null;
  const allFilteredSelected = pageRows.length > 0 && pageRows.every((p) => selectedIds.has(p.id));
  const someSelected = selectedIds.size > 0;

  // Anchor row (by id) for shift-click range select.
  const lastCheckedRowIdRef = useRef<string | null>(null);

  function toggleSelect(id: string, index: number, shiftKey: boolean) {
    setSelectedIds((prev) => applyShiftClickSelection(pageRows, index, shiftKey, lastCheckedRowIdRef.current, prev));
    lastCheckedRowIdRef.current = id;
  }

  // Toggles selection for the CURRENT page only -- "Select all N matching"
  // below is the separate action that expands to every page.
  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        pageRows.forEach((p) => next.delete(p.id));
        return next;
      });
      setIsAllMatchingSelected(false);
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        pageRows.forEach((p) => next.add(p.id));
        return next;
      });
    }
  }

  // Everything matching the active filters is already loaded in `filtered`
  // (see the fetch-everything comment above), so expanding the selection to
  // all of it is just a synchronous set build -- no extra fetch needed.
  function handleSelectAllMatching() {
    setSelectedIds(new Set(filtered.map((p) => p.id)));
    setIsAllMatchingSelected(true);
  }

  // "Add to list" and delete both operate on the real prospects table
  // (bulk-delete-prospects, add-prospects-to-lead-list) -- a lead_list-
  // sourced row isn't in that table, so those bulk actions only apply to
  // the prospect-sourced subset of the current selection.
  const selectedProspectSourced = useMemo(
    () => allProspects.filter((p) => selectedIds.has(p.id) && p.source === "prospect"),
    [allProspects, selectedIds],
  );

  // Score & Draft only applies to not-yet-visited lead_list-sourced rows --
  // a real prospects row already has a fit score/draft, so bulk scoring
  // only targets the complementary subset of the selection.
  const selectedLeadListSourced = useMemo(
    () => allProspects.filter((p) => selectedIds.has(p.id) && p.source === "lead_list"),
    [allProspects, selectedIds],
  );

  async function handleBulkDelete() {
    // Deletes both halves of a mixed selection -- a promoted prospects row
    // and a not-yet-promoted lead_list row are different tables with no
    // shared delete endpoint, so this always needs up to two calls.
    await Promise.all([
      selectedProspectSourced.length > 0
        ? bulkDeleteProspects.mutateAsync({ ids: selectedProspectSourced.map((p) => p.rawId) })
        : null,
      selectedLeadListSourced.length > 0
        ? bulkDeleteLeadListItems.mutateAsync({ ids: selectedLeadListSourced.map((p) => p.rawId) })
        : null,
    ]);
    setSelectedIds(new Set());
    setIsAllMatchingSelected(false);
    setBulkConfirmDelete(false);
    refetch();
  }

  async function handleBulkMarkSent() {
    const toMark = selectedProspectSourced.filter((p) => p.status !== "sent" && p.profileUrl);
    for (const p of toMark) {
      await markSent.mutateAsync({ profileUrl: p.profileUrl! });
    }
    setSelectedIds(new Set());
    setIsAllMatchingSelected(false);
    refetch();
  }

  async function handleToggleProspectTag(prospect: Prospect, tagId: string) {
    const nextIds = new Set(prospect.tags.map((t) => t.id));
    nextIds.has(tagId) ? nextIds.delete(tagId) : nextIds.add(tagId);
    await setProspectTags.mutateAsync({ prospectId: prospect.rawId, tagIds: [...nextIds] });
    refetch();
  }

  async function handleCreateTag(name: string, color: string) {
    const result = await createTag.mutateAsync({ name, color });
    tagsQuery.refetch();
    return result as { ok: boolean; error?: string };
  }

  async function handleRenameTag(id: string, name: string) {
    await updateTag.mutateAsync({ id, name });
    tagsQuery.refetch();
  }

  async function handleDeleteTag(id: string) {
    await deleteTag.mutateAsync({ id });
    tagsQuery.refetch();
    refetch();
    setTagFilterIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  async function handleBulkTag(tagId: string) {
    await bulkTagProspects.mutateAsync({ prospectIds: selectedProspectSourced.map((p) => p.rawId), tagId });
    setSelectedIds(new Set());
    setIsAllMatchingSelected(false);
    refetch();
  }

  async function enrichOne(prospect: Prospect) {
    if (prospect.source === "prospect") await enrichProspect.mutateAsync({ id: prospect.rawId });
    else await enrichLeadListItem.mutateAsync({ itemId: prospect.rawId });
  }

  async function handleEnrich(prospect: Prospect) {
    setEnrichingIds((prev) => new Set(prev).add(prospect.id));
    try {
      await enrichOne(prospect);
    } finally {
      setEnrichingIds((prev) => {
        const next = new Set(prev);
        next.delete(prospect.id);
        return next;
      });
      refetch();
    }
  }

  async function handleScoreDraft(prospect: Prospect) {
    setScoringIds((prev) => new Set(prev).add(prospect.id));
    setScoringErrors((prev) => {
      const next = new Map(prev);
      next.delete(prospect.id);
      return next;
    });
    try {
      const result = await scoreLeadListItem.mutateAsync({ itemId: prospect.rawId });
      if (result?.error) {
        const message = result.error;
        setScoringErrors((prev) => new Map(prev).set(prospect.id, message));
        return;
      }
      refetch();
    } catch (err) {
      setScoringErrors((prev) => new Map(prev).set(prospect.id, err instanceof Error ? err.message : "Something went wrong."));
    } finally {
      setScoringIds((prev) => {
        const next = new Set(prev);
        next.delete(prospect.id);
        return next;
      });
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
        await enrichOne(p);
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
    setIsAllMatchingSelected(false);
    refetch();
  }

  // Sequential, not parallel -- this spends a real LLM call per lead
  // (500/hr bucket, still tighter than Apollo's 1000/hr), and a rate-limit
  // hit surfaces as a normal per-item error rather than throwing, so the
  // batch can just keep recording errors and move on.
  async function handleBulkScoreDraft() {
    const targets = selectedLeadListSourced;
    if (targets.length === 0) return;
    setBulkScoreDraftProgress({ done: 0, total: targets.length });
    for (const p of targets) {
      setScoringIds((prev) => new Set(prev).add(p.id));
      setScoringErrors((prev) => {
        const next = new Map(prev);
        next.delete(p.id);
        return next;
      });
      try {
        const result = await scoreLeadListItem.mutateAsync({ itemId: p.rawId });
        if (result?.error) {
          const message = result.error;
          setScoringErrors((prev) => new Map(prev).set(p.id, message));
        }
      } catch (err) {
        setScoringErrors((prev) => new Map(prev).set(p.id, err instanceof Error ? err.message : "Something went wrong."));
      } finally {
        setScoringIds((prev) => {
          const next = new Set(prev);
          next.delete(p.id);
          return next;
        });
        setBulkScoreDraftProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
      }
    }
    setBulkScoreDraftProgress(null);
    setSelectedIds(new Set());
    setIsAllMatchingSelected(false);
    refetch();
  }

  const hasActiveFilter = verdictFilter !== "all" || tagFilterIds.size > 0 || personaFilter !== "all" || recencyFilter !== "all" || search;

  async function handleExportAll() {
    setIsExporting(true);
    setExportError(null);
    try {
      // allProspects already holds everything (the main query fetches up to
      // PROSPECTS_FETCH_LIMIT in one shot) -- no need for a separate fetch.
      if (allProspects.length === 0) {
        setExportError("Nothing to export yet.");
        return;
      }
      const csv = buildMasterCsv(allProspects);
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
      {/* Header */}
      <div className={cn("border-b border-border", someSelected && "bg-primary/5")}>
      <div className="flex items-center justify-between px-4 py-3 min-h-[52px]">
        {someSelected ? (
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-foreground">{selectedIds.size} selected</span>
            <button type="button" onClick={() => { setSelectedIds(new Set()); setIsAllMatchingSelected(false); }}
              className="text-xs text-muted-foreground hover:text-foreground">Deselect all</button>
            <div className="h-4 w-px bg-border" />
            {bulkConfirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Delete {selectedIds.size} leads?</span>
                <button type="button" onClick={handleBulkDelete} disabled={bulkDeleteProspects.isPending || bulkDeleteLeadListItems.isPending}
                  className="rounded px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50">
                  {bulkDeleteProspects.isPending || bulkDeleteLeadListItems.isPending ? "Deleting…" : "Confirm"}
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
                {bulkScoreDraftProgress ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <IconLoader2 size={12} className="animate-spin" />
                    Scoring {bulkScoreDraftProgress.done}/{bulkScoreDraftProgress.total}…
                  </span>
                ) : (
                  <button type="button" onClick={handleBulkScoreDraft}
                    disabled={selectedLeadListSourced.length === 0}
                    title={selectedLeadListSourced.length === 0 ? "Only not-yet-visited leads can be scored here" : undefined}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:pointer-events-none">
                    <IconSparkles size={13} /> Score &amp; Draft selected
                  </button>
                )}
                <AddToListPopover
                  prospectIds={selectedProspectSourced.map((p) => p.rawId)}
                  onDone={() => { setSelectedIds(new Set()); setIsAllMatchingSelected(false); }}
                />
                <BulkTagPopover
                  prospectIds={selectedProspectSourced.map((p) => p.rawId)}
                  allTags={allTags}
                  onApply={handleBulkTag}
                />
              </>
            )}
          </div>
        ) : (
          <div className="flex w-full items-center justify-between">
            <div>
              <h1 className="text-sm font-semibold text-foreground">Prospects</h1>
              <p className="text-xs text-muted-foreground">
                {isLoading
                  ? "Loading…"
                  : hasActiveFilter
                    ? `${filtered.length} of ${allProspects.length} match`
                    : `${prospectsTotalCount.toLocaleString()} prospect${prospectsTotalCount === 1 ? "" : "s"} — captured profiles + Lead Lists leads, combined and deduped by profile URL, live on every load`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {exportError && <span className="text-xs text-destructive">{exportError}</span>}
              <TagManagerPopover
                trigger={
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
                  >
                    <IconTag size={12} />
                    Manage tags
                  </button>
                }
                allTags={allTags}
                onCreateTag={handleCreateTag}
                onRenameTag={handleRenameTag}
                onDeleteTag={handleDeleteTag}
              />
              <ColumnVisibilityPopover hidden={hiddenColumns} onToggle={toggleColumn} />
              <button
                type="button"
                onClick={() => refetch()}
                disabled={isFetching}
                title="Refresh"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                <IconRefresh size={12} className={isFetching ? "animate-spin" : undefined} />
                Refresh
              </button>
              <button
                type="button"
                onClick={handleExportAll}
                disabled={isExporting || prospectsTotalCount === 0}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                {isExporting ? <IconLoader2 size={12} className="animate-spin" /> : <IconDownload size={12} />}
                Export CSV
              </button>
            </div>
          </div>
        )}
      </div>

      {allFilteredSelected && !isAllMatchingSelected && filtered.length > pageRows.length && (
        <div className="flex items-center gap-1.5 px-4 pb-2.5 text-xs text-muted-foreground">
          <span>{pageRows.length} on this page selected.</span>
          <button
            type="button"
            onClick={handleSelectAllMatching}
            className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/25"
          >
            Select all {filtered.length.toLocaleString()} matching
          </button>
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

        {/* Tags */}
        {allTags.length > 0 && (
          <TagFilterControl
            allTags={allTags}
            selectedIds={tagFilterIds}
            onChangeSelected={setTagFilterIds}
            mode={tagFilterMode}
            onChangeMode={setTagFilterMode}
          />
        )}

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

        <div className="h-4 w-px bg-border" />

        {/* Recency -- quick way to grab everything captured today/this week
            for a fast "select all, Add to list" pass. */}
        <div className="flex items-center gap-1">
          <FilterPill active={recencyFilter === "all"} onClick={() => setRecencyFilter("all")}>Any time</FilterPill>
          <FilterPill active={recencyFilter === "today"} onClick={() => setRecencyFilter(recencyFilter === "today" ? "all" : "today")}>Added today</FilterPill>
          <FilterPill active={recencyFilter === "week"} onClick={() => setRecencyFilter(recencyFilter === "week" ? "all" : "week")}>Added this week</FilterPill>
        </div>

        {hasActiveFilter && (
          <button type="button"
            onClick={() => { setSearch(""); setVerdictFilter("all"); setTagFilterIds(new Set()); setPersonaFilter("all"); setRecencyFilter("all"); }}
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
              <button type="button" onClick={() => { setSearch(""); setVerdictFilter("all"); setTagFilterIds(new Set()); setPersonaFilter("all"); setRecencyFilter("all"); }}
                className="text-xs text-primary hover:underline">Clear filters</button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="sticky top-0 z-10 bg-muted py-2 pl-3 pr-1 w-8">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAll}
                    className="rounded border-border"
                    title="Select all"
                  />
                </th>
                <th scope="col" className="sticky top-0 z-10 bg-muted py-2 pl-2 pr-3 text-left text-xs font-medium text-muted-foreground">Person</th>
                {!hiddenColumns.has("company") && (
                  <th scope="col" className="sticky top-0 z-10 bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">Company</th>
                )}
                {!hiddenColumns.has("persona") && (
                  <th scope="col" className="sticky top-0 z-10 bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">Persona</th>
                )}
                {!hiddenColumns.has("jobTitle") && (
                  <th scope="col" className="sticky top-0 z-10 bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">Job Title</th>
                )}
                {!hiddenColumns.has("fit") && (
                  <th scope="col" className="sticky top-0 z-10 bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">Fit</th>
                )}
                {!hiddenColumns.has("tags") && (
                  <th scope="col" className="sticky top-0 z-10 bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">Tags</th>
                )}
                {!hiddenColumns.has("draftNote") && (
                  <th scope="col" className="sticky top-0 z-10 bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">Draft note</th>
                )}
                {!hiddenColumns.has("email") && (
                  <th scope="col" className="sticky top-0 z-10 bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">Email</th>
                )}
                {!hiddenColumns.has("phone") && (
                  <th scope="col" className="sticky top-0 z-10 bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">Phone</th>
                )}
                <th scope="col" className="sticky top-0 z-10 bg-muted py-2 pl-3 pr-4 text-left text-xs font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((p, rowIndex) => {
                const isChecked = selectedIds.has(p.id);
                const note = p.draftNote ?? "";
                const displayName = p.name ?? p.profileUrl ?? "Unknown";
                return (
                  <tr
                    key={p.id}
                    className={`group border-b border-border last:border-0 transition-colors cursor-pointer ${isChecked ? "bg-muted/60" : "hover:bg-muted/40"}`}
                    onClick={() => setSelectedId(p.id)}
                  >
                    {/* Checkbox -- shift-click selects the whole range since the last clicked row */}
                    <td className="py-3 pl-3 pr-1 w-8" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}}
                        onClick={(e) => toggleSelect(p.id, rowIndex, e.shiftKey)}
                        className="rounded border-border"
                      />
                    </td>

                    {/* Person */}
                    <td className="py-3 pl-2 pr-3">
                      <div className="flex items-center gap-1.5">
                        <IconBrandLinkedin size={13} className="shrink-0 text-[#0077B5]" />
                        <span className="font-medium text-foreground group-hover:text-primary truncate max-w-[180px]">{displayName}</span>
                        {p.source === "lead_list" && (
                          <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shrink-0 truncate max-w-[100px]">
                            {p.listName ?? "Lead list"}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Company -- own column (was a truncated sub-line
                        buried under Person) so it's scannable on its own,
                        matching Persona/Job Title's treatment. Logo/avatar +
                        hover card with HubSpot deals/contacts. */}
                    {!hiddenColumns.has("company") && (
                      <td className="px-3 py-3">
                        <CompanyCell company={p.company} companyDomain={p.companyDomain} />
                      </td>
                    )}

                    {/* Persona -- own column (not just a chip buried in the
                        Person cell) so scanning/filtering by persona is
                        easier at a glance. */}
                    {!hiddenColumns.has("persona") && (
                      <td className="px-3 py-3">
                        {p.personaName && p.personaColor ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            <span style={{ background: p.personaColor }} className="inline-block h-1.5 w-1.5 rounded-full shrink-0" />
                            {p.personaName}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    )}

                    {/* Job Title -- prefers Apollo's enrichedTitle (kept
                        current by Enrich/Re-enrich) over the LinkedIn-scraped
                        role/headline, which can go stale or was never set for
                        a lead-list row that hasn't been visited. */}
                    {!hiddenColumns.has("jobTitle") && (
                      <td className="px-3 py-3">
                        <span className="text-xs text-muted-foreground truncate max-w-[180px] block">
                          {p.enrichedTitle || p.role || p.headline || "—"}
                        </span>
                      </td>
                    )}

                    {/* Fit -- full rationale lives in ProspectSheet (opened
                        by the existing row click), so the cell only needs
                        the badge, not a truncated repeat of the same text. */}
                    {!hiddenColumns.has("fit") && (
                      <td className="px-3 py-3 min-w-[150px]">
                        <VerdictBadge verdict={p.fitVerdict} />
                      </td>
                    )}

                    {/* Tags */}
                    {!hiddenColumns.has("tags") && (
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        {p.source === "prospect" ? (
                          <TagPickerCell
                            prospect={p}
                            allTags={allTags}
                            onToggleTag={(tagId) => handleToggleProspectTag(p, tagId)}
                            onCreateTag={handleCreateTag}
                            onRenameTag={handleRenameTag}
                            onDeleteTag={handleDeleteTag}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    )}

                    {/* Draft note -- full text lives in ProspectSheet (opened
                        by the existing row click) and is editable there, so
                        the cell only needs a status pill, not a truncated
                        repeat. Preserves the same three states the old
                        line-clamp fallback used. */}
                    {!hiddenColumns.has("draftNote") && (
                      <td className="px-3 py-3">
                        {note ? (
                          <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            Drafted
                          </span>
                        ) : p.status === "captured" ? (
                          <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium italic text-muted-foreground/70">
                            Drafting…
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/50 italic">No note</span>
                        )}
                      </td>
                    )}

                    {/* Email */}
                    {!hiddenColumns.has("email") && (
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <EnrichedField
                          value={p.enrichedEmail}
                          status={p.enrichmentStatus}
                          kind="email"
                          enrichmentSource={p.enrichmentSource}
                          enrichedEmailStatus={p.enrichedEmailStatus}
                          enrichedAt={p.enrichedAt}
                          isEnriching={enrichingIds.has(p.id)}
                          onEnrich={() => handleEnrich(p)}
                        />
                      </td>
                    )}

                    {/* Phone */}
                    {!hiddenColumns.has("phone") && (
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <EnrichedField
                          value={p.enrichedPhone}
                          status={p.enrichmentStatus}
                          kind="phone"
                          phoneRevealStatus={p.phoneRevealStatus}
                          phoneRevealRequestedAt={p.phoneRevealRequestedAt}
                          enrichmentSource={p.enrichmentSource}
                          enrichedAt={p.enrichedAt}
                          isEnriching={enrichingIds.has(p.id)}
                          onEnrich={() => handleEnrich(p)}
                        />
                      </td>
                    )}

                    {/* Actions */}
                    <td className="py-3 pl-3 pr-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5">
                        {note && <CopyButton text={note} />}
                        <EnrichButton prospect={p} isEnriching={enrichingIds.has(p.id)} onEnrich={handleEnrich} />
                        {p.source === "lead_list" && (
                          <ScoreDraftButton
                            prospect={p}
                            isScoring={scoringIds.has(p.id)}
                            error={scoringErrors.get(p.id)}
                            onScore={handleScoreDraft}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {filtered.length > 0 && (
        <div className="flex items-center justify-end border-t border-border px-4 py-2">
          <Pagination page={prospectsPage} pageSize={PROSPECTS_PAGE_SIZE} totalCount={filtered.length} onPageChange={setProspectsPage} />
        </div>
      )}

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

// Lets a rep build a Lead List directly from selected Prospects, mirroring
// the extension's "Create List" / "Add to Existing List" pattern -- once a
// prospect is in a list, Apollo enrichment, phone reveal, and the Apollo
// CSV export all work on it identically, since lead_list_items shares the
// same enrichment column shape as prospects.
function AddToListPopover({ prospectIds, onDone }: { prospectIds: string[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "existing">("create");
  const [newListName, setNewListName] = useState("");
  const [newListDescription, setNewListDescription] = useState("");
  const [existingListId, setExistingListId] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const listsQuery = useActionQuery("list-lead-lists", {}, { enabled: open });
  const lists = ((listsQuery.data as { lists?: { id: string; name: string; totalCount: number }[] } | undefined)?.lists ?? []);
  const addToList = useActionMutation("add-prospects-to-lead-list");

  function resetForm() {
    setNewListName("");
    setNewListDescription("");
    setExistingListId("");
    setStatus(null);
    setMode("create");
  }

  async function handleSubmit() {
    setStatus(null);
    const payload =
      mode === "create"
        ? { prospectIds, newListName, newListDescription: newListDescription || null }
        : { prospectIds, existingListId };
    if (mode === "create" && !newListName.trim()) {
      setStatus("Give the new list a name.");
      return;
    }
    if (mode === "existing" && !existingListId) {
      setStatus("Pick a list.");
      return;
    }
    try {
      const result = await addToList.mutateAsync(payload);
      if (result?.error) {
        setStatus(result.error);
        return;
      }
      setOpen(false);
      resetForm();
      onDone();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) resetForm(); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={prospectIds.length === 0}
          title={prospectIds.length === 0 ? "Only visited prospects can be added to a list" : undefined}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
        >
          <IconListCheck size={13} /> Add to list
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <div className="mb-2 flex gap-1 rounded-lg border border-border bg-muted/40 p-1">
          <button
            type="button"
            onClick={() => setMode("create")}
            className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              mode === "create" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            New list
          </button>
          <button
            type="button"
            onClick={() => setMode("existing")}
            className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              mode === "existing" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Existing list
          </button>
        </div>

        {mode === "create" ? (
          <div className="space-y-2">
            <input
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              placeholder="Name this list…"
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <textarea
              value={newListDescription}
              onChange={(e) => setNewListDescription(e.target.value)}
              placeholder="Description (optional)…"
              rows={2}
              className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        ) : (
          <select
            value={existingListId}
            onChange={(e) => setExistingListId(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">
              {listsQuery.isLoading ? "Loading your lists…" : lists.length === 0 ? "No lists yet" : "Select a list…"}
            </option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.totalCount} lead{l.totalCount === 1 ? "" : "s"})
              </option>
            ))}
          </select>
        )}

        {status && <p className="mt-2 text-xs text-destructive">{status}</p>}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={addToList.isPending || prospectIds.length === 0}
          className="mt-3 w-full rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {addToList.isPending ? "Adding…" : `Add ${prospectIds.length} prospect${prospectIds.length === 1 ? "" : "s"}`}
        </button>
      </PopoverContent>
    </Popover>
  );
}

function ColumnVisibilityPopover({
  hidden,
  onToggle,
}: {
  hidden: Set<string>;
  onToggle: (key: string) => void;
}) {
  const hiddenCount = PROSPECT_HIDEABLE_COLUMNS.filter((c) => hidden.has(c.key)).length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
        >
          <IconLayoutColumns size={12} />
          Columns{hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ""}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-2">
        <p className="px-1.5 pb-1.5 text-xs font-medium text-muted-foreground">Show columns</p>
        <div className="space-y-0.5">
          {PROSPECT_HIDEABLE_COLUMNS.map((col) => (
            <label
              key={col.key}
              className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={!hidden.has(col.key)}
                onChange={() => onToggle(col.key)}
                className="rounded border-border"
              />
              {col.label}
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Tags ─────────────────────────────────────────────────────────────────────

type TagMutationResult = { ok: boolean; error?: string };

// Reused for both assigning tags to one prospect (assignedTagIds/onToggleAssign
// set -- shows a checkbox per tag) and pure tag management from the page
// header (those two props omitted -- just create/rename/recolor/delete, no
// checkboxes). Same create-and-color-swatch pattern as ICP Personas
// (app/routes/icp.tsx) for visual consistency.
function TagManagerPopover({
  trigger,
  allTags,
  assignedTagIds,
  onToggleAssign,
  onCreateTag,
  onRenameTag,
  onDeleteTag,
}: {
  trigger: React.ReactNode;
  allTags: Tag[];
  assignedTagIds?: Set<string>;
  onToggleAssign?: (tagId: string) => void;
  onCreateTag: (name: string, color: string) => Promise<TagMutationResult>;
  onRenameTag: (id: string, name: string) => Promise<void>;
  onDeleteTag: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  function reset() {
    setEditingId(null);
    setConfirmDeleteId(null);
    setError(null);
  }

  function startEdit(tag: Tag) {
    setEditingId(tag.id);
    setEditName(tag.name);
    setConfirmDeleteId(null);
  }

  async function commitEditName(tag: Tag) {
    const trimmed = editName.trim();
    setEditingId(null);
    if (trimmed && trimmed !== tag.name) await onRenameTag(tag.id, trimmed);
  }

  async function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setCreating(true);
    setError(null);
    try {
      const result = await onCreateTag(trimmed, randomTagColor());
      if (result?.error) {
        setError(result.error);
        return;
      }
      setNewName("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="max-h-64 overflow-y-auto">
          {allTags.length === 0 && (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">No tags yet -- create one below.</p>
          )}
          {allTags.map((tag) => (
            <div key={tag.id} className="group flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-muted/60">
              {editingId === tag.id ? (
                <input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEditName(tag);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onBlur={() => commitEditName(tag)}
                  maxLength={40}
                  className="min-w-0 flex-1 rounded border border-primary/50 bg-background px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
              ) : confirmDeleteId === tag.id ? (
                <>
                  <span className="flex-1 truncate text-xs text-muted-foreground">Delete "{tag.name}"?</span>
                  <button
                    type="button"
                    onClick={() => onDeleteTag(tag.id)}
                    className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-destructive hover:bg-destructive/10"
                  >
                    Confirm
                  </button>
                  <button type="button" onClick={() => setConfirmDeleteId(null)} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted">
                    <IconX size={12} />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onToggleAssign?.(tag.id)}
                    disabled={!onToggleAssign}
                    className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left disabled:cursor-default"
                  >
                    <span className="min-w-0 flex-1 truncate text-xs">{tag.name}</span>
                    {onToggleAssign && (
                      <input type="checkbox" readOnly checked={assignedTagIds?.has(tag.id) ?? false} className="shrink-0 rounded border-border" />
                    )}
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
                    <button type="button" onClick={() => startEdit(tag)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="Rename">
                      <IconPencil size={12} />
                    </button>
                    <button type="button" onClick={() => setConfirmDeleteId(tag.id)} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Delete">
                      <IconTrash size={12} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="mt-2 border-t border-border pt-2">
          <div className="flex gap-1.5">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
              placeholder="New tag name…"
              maxLength={40}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
              className="shrink-0 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {creating ? <IconLoader2 size={12} className="animate-spin" /> : "Add"}
            </button>
          </div>
          {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TagPickerCell({
  prospect,
  allTags,
  onToggleTag,
  onCreateTag,
  onRenameTag,
  onDeleteTag,
}: {
  prospect: Prospect;
  allTags: Tag[];
  onToggleTag: (tagId: string) => void;
  onCreateTag: (name: string, color: string) => Promise<TagMutationResult>;
  onRenameTag: (id: string, name: string) => Promise<void>;
  onDeleteTag: (id: string) => Promise<void>;
}) {
  const assignedIds = useMemo(() => new Set(prospect.tags.map((t) => t.id)), [prospect.tags]);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {prospect.tags.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium"
          style={{ background: `${tag.color}26`, color: tag.color }}
        >
          {tag.name}
        </span>
      ))}
      <TagManagerPopover
        trigger={
          <button
            type="button"
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground hover:border-border hover:text-foreground"
            title="Edit tags"
          >
            <IconPlus size={11} />
          </button>
        }
        allTags={allTags}
        assignedTagIds={assignedIds}
        onToggleAssign={onToggleTag}
        onCreateTag={onCreateTag}
        onRenameTag={onRenameTag}
        onDeleteTag={onDeleteTag}
      />
    </div>
  );
}

function BulkTagPopover({
  prospectIds,
  allTags,
  onApply,
}: {
  prospectIds: string[];
  allTags: Tag[];
  onApply: (tagId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={prospectIds.length === 0}
          title={prospectIds.length === 0 ? "Only visited prospects can be tagged" : undefined}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
        >
          <IconTag size={13} /> Tag selected
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1.5">
        {allTags.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">No tags yet -- create one from any prospect's tag picker.</p>
        ) : (
          allTags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={async () => { await onApply(tag.id); setOpen(false); }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
            >
              <span style={{ background: tag.color }} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" />
              {tag.name}
            </button>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}

// One chip that opens a dropdown of every tag as a search-filterable
// checkbox list, plus an "any of"/"all of" match-mode select -- instead of
// one FilterPill per tag (which doesn't scale once there are more than a
// handful of tags).
function TagFilterControl({
  allTags,
  selectedIds,
  onChangeSelected,
  mode,
  onChangeMode,
}: {
  allTags: Tag[];
  selectedIds: Set<string>;
  onChangeSelected: (next: Set<string>) => void;
  mode: "any" | "all";
  onChangeMode: (next: "any" | "all") => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const visibleTags = allTags.filter((t) => t.name.toLowerCase().includes(query.trim().toLowerCase()));

  function toggle(id: string) {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    onChangeSelected(next);
  }

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
            selectedIds.size > 0
              ? "border-foreground/30 bg-foreground/10 text-foreground"
              : "border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground"
          }`}
        >
          <IconTag size={11} />
          {selectedIds.size === 0 ? "Tags" : `Tags (${selectedIds.size})`}
          {selectedIds.size > 0 ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onChangeSelected(new Set()); }}
              className="ml-0.5 rounded-full p-0.5 hover:bg-foreground/10"
            >
              <IconX size={11} />
            </span>
          ) : (
            <IconChevronDown size={11} />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        <select
          value={mode}
          onChange={(e) => onChangeMode(e.target.value as "any" | "all")}
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="any">any of</option>
          <option value="all">all of</option>
        </select>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find tags…"
          autoFocus
          className="mt-1.5 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />

        <div className="mt-1.5 max-h-56 overflow-y-auto">
          {visibleTags.length === 0 ? (
            <p className="px-1 py-3 text-center text-xs text-muted-foreground">No matching tags.</p>
          ) : (
            visibleTags.map((tag) => (
              <label
                key={tag.id}
                className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-xs hover:bg-muted/60 cursor-pointer"
              >
                <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                <input
                  type="checkbox"
                  checked={selectedIds.has(tag.id)}
                  onChange={() => toggle(tag.id)}
                  className="shrink-0 rounded border-border"
                />
              </label>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
