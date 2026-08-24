import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { IconBrandLinkedin, IconBriefcase, IconChevronDown, IconCoin, IconExternalLink, IconLoader2, IconRefresh, IconSearch, IconTag, IconUsers, IconX } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { CompanyLogo } from "@/components/company-logo";
import { Pagination } from "@/components/Pagination";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { APP_TITLE } from "@/lib/app-config";
import { contactLinkedInHref, formatDealAmount, formatRelativeActivity, useHubSpotCompany } from "@/lib/hubspot-company";
import { cn } from "@/lib/utils";

const ACCOUNTS_PAGE_SIZE = 25;

// Same pill styling as the Prospects table's filter row (FilterPill there).
function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
        active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function meta() {
  return [{ title: `${APP_TITLE} — My Accounts` }];
}

type MatchedVia = "companyOwner" | "xdrOwner" | "both";

type TagTone = "tier" | "positive" | "neutral" | "warm";

interface CompanyTag {
  key: string;
  label: string;
  value: string;
  tone: TagTone;
  emphasis: boolean;
}

interface OwnedCompany {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employeeCount: string | null;
  matchedVia: MatchedVia;
  tags: CompanyTag[];
}

// Tier gets the strongest treatment since it's the primary value signal;
// positive (target account, qualified contacts) reads as opportunity;
// neutral is context, not priority. `warm` is currently unused -- kept as
// an available slot in the palette for a future opportunity-signal tag.
const TAG_TONE_CLASS: Record<TagTone, string> = {
  tier: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  positive: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  warm: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  neutral: "bg-muted text-muted-foreground",
};

// Dot-only variant for filter pills, whose own background already carries
// the active/inactive state -- a full tone background would fight it.
const TAG_TONE_DOT: Record<TagTone, string> = {
  tier: "bg-amber-500",
  positive: "bg-emerald-500",
  warm: "bg-violet-500",
  neutral: "bg-muted-foreground/50",
};

function TagChip({ tag }: { tag: CompanyTag }) {
  return (
    <span
      title={`${tag.label}: ${tag.value}`}
      className={cn(
        "inline-flex max-w-[130px] items-center truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        TAG_TONE_CLASS[tag.tone],
      )}
    >
      {tag.value}
    </span>
  );
}

// The table column is narrow, so it shows only the two highest-signal
// tags. Hovering reveals the FULL set -- including the lower-signal
// context tags (territory, region, ABX program) that are otherwise
// detail-panel-only -- so the truncation never hides data with no way to
// see it.
function TagsCell({ tags }: { tags: CompanyTag[] }) {
  const emphasized = tags.filter((t) => t.emphasis);
  if (tags.length === 0) return <span className="text-xs text-muted-foreground">—</span>;

  const visible = emphasized.slice(0, 2);
  const hiddenCount = tags.length - visible.length;

  return (
    <HoverCard openDelay={150}>
      <HoverCardTrigger asChild>
        <div className="flex w-fit flex-wrap items-center gap-1">
          {visible.map((t) => (
            <TagChip key={t.key} tag={t} />
          ))}
          {hiddenCount > 0 && <span className="text-[10px] text-muted-foreground/70">+{hiddenCount}</span>}
        </div>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-auto max-w-xs p-2">
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t.key}
              className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", TAG_TONE_CLASS[t.tone])}
            >
              <span className="opacity-70">{t.label}:</span>
              <span className="ml-1">{t.value.startsWith(`${t.label}: `) ? t.value.slice(t.label.length + 2) : t.value}</span>
            </span>
          ))}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

// AEs are attributed via the native Company owner property, xDRs via the
// custom xDR Owner property -- shown per row so either audience can see
// which relationship earned this account a spot on their list.
const MATCHED_VIA_LABEL: Record<MatchedVia, string> = {
  companyOwner: "Company owner",
  xdrOwner: "xDR owner",
  both: "Company + xDR owner",
};

interface MyOwnedAccountsData {
  connected: boolean;
  matched: boolean;
  noOwnerRecord?: boolean;
  error?: string;
  companies: OwnedCompany[];
  total: number;
  truncated?: boolean;
}

// Same "just open a URL, no scraping or auto-navigation" pattern as the
// existing LinkedIn fallback links in _index.tsx/lead-lists.tsx --
// /sales/search/people is Sales Navigator's own search view (see
// extension/content.js's comment on why the Lead tab specifically).
//
// Uses a real CURRENT_COMPANY filter chip rather than a keyword string:
// LinkedIn keyword search matches text anywhere on a profile INCLUDING
// past roles, so a keyword company search surfaces former employees. The
// id-less entry shape here is live-verified -- see the long comment in
// actions/generate-sales-nav-search.ts, which builds the same filter
// server-side for the persona-scoped searches.
function salesNavSearchHref(companyName: string): string {
  const encodeLeaf = (v: string) => encodeURIComponent(v).replace(/\(/g, "%28").replace(/\)/g, "%29");
  const rawQuery = `(filters:List((type:CURRENT_COMPANY,values:List((text:${encodeLeaf(companyName)},selectionType:INCLUDED)))))`;
  return `https://www.linkedin.com/sales/search/people?query=${encodeURIComponent(rawQuery)}`;
}

// HubSpot's industry property is a raw enum ("COMPUTER_SOFTWARE") -- title
// case it for display, same spirit as the rest of this app never showing
// a raw enum value to the xDR.
function formatIndustry(industry: string | null): string {
  if (!industry) return "—";
  return industry
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

function formatEmployeeCount(count: string | null): string {
  if (!count) return "—";
  const n = Number(count);
  return Number.isFinite(n) ? n.toLocaleString() : count;
}

interface IcpPersona {
  id: string;
  name: string;
  color: string;
  isActive: number;
}

interface GenerateSearchResult {
  searchUrl?: string;
  summary?: string | null;
  matchedPersonaName?: string | null;
  appliedFilters?: string[];
  unsupportedNotes?: string | null;
  error?: string;
}

// One entry point for every LinkedIn search off an account, rather than a
// separate "everyone here" button plus a persona button.
//
// "Everyone" is a plain client-built CURRENT_COMPANY link (no round trip).
// Persona entries go through generate-sales-nav-search.ts and pass this
// persona's id, which lets the server use that persona's exact generated
// briefing (primary titles, fallback titles, "wrong buyer" exclusions)
// directly as real Sales Nav filter chips, and takes the account's company
// name so the result stays scoped to this one account instead of every
// "Design Persona"-shaped lead on LinkedIn.
function QuickSearchPopover({ companyName, personas }: { companyName: string; personas: IcpPersona[] }) {
  const [open, setOpen] = useState(false);
  const [pendingPersonaId, setPendingPersonaId] = useState<string | null>(null);
  const generateSearch = useActionMutation("generate-sales-nav-search");

  async function handlePersonaClick(persona: IcpPersona) {
    setPendingPersonaId(persona.id);
    try {
      const result = (await generateSearch.mutateAsync({
        prompt: persona.name,
        personaId: persona.id,
        companyName,
      })) as GenerateSearchResult;
      if (!result?.searchUrl) {
        toast.error(result?.error ?? "Could not generate a search for that persona -- try again.");
        return;
      }
      if (result.unsupportedNotes) toast.message(result.unsupportedNotes);
      window.open(result.searchUrl, "_blank", "noopener,noreferrer");
      setOpen(false);
    } catch {
      toast.error("Could not generate a search for that persona -- try again.");
    } finally {
      setPendingPersonaId(null);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted"
        >
          <IconSearch size={11} /> Quick search <IconChevronDown size={10} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-1.5">
        <p className="px-1.5 py-1 text-[11px] font-medium text-muted-foreground">Search LinkedIn for…</p>
        <div className="grid gap-0.5">
          <a
            href={salesNavSearchHref(companyName)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1.5 text-xs hover:bg-muted"
          >
            <IconUsers size={11} className="shrink-0 text-muted-foreground" />
            <span className="truncate">Everyone at {companyName}</span>
            <IconExternalLink size={10} className="ml-auto shrink-0 text-muted-foreground" />
          </a>

          {personas.length > 0 && (
            <>
              <div className="my-1 h-px bg-border" />
              <p className="px-1.5 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">By persona</p>
              {personas.map((persona) => (
                <button
                  key={persona.id}
                  type="button"
                  disabled={generateSearch.isPending}
                  onClick={() => handlePersonaClick(persona)}
                  className="flex items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50"
                >
                  {pendingPersonaId === persona.id ? (
                    <IconLoader2 size={11} className="shrink-0 animate-spin text-muted-foreground" />
                  ) : (
                    <span style={{ background: persona.color }} className="inline-block size-1.5 shrink-0 rounded-full" />
                  )}
                  <span className="truncate">{persona.name}</span>
                </button>
              ))}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SheetSection({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="pt-4 border-t border-border first:border-t-0 first:pt-0">
      <div className="mb-2 flex items-center gap-1.5">
        {icon}
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      </div>
      {children}
    </div>
  );
}

function DealRows({ deals }: { deals: Array<{ name: string; amount: string | null; closeDate: string | null }> }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border divide-y divide-border bg-muted/20">
      {deals.map((d, i) => (
        <div key={i} className="flex items-center justify-between gap-3 px-3 py-2">
          <span className="truncate text-xs text-foreground">{d.name || "Untitled deal"}</span>
          <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">{formatDealAmount(d.amount) ?? "—"}</span>
        </div>
      ))}
    </div>
  );
}

// Mirrors ProspectSheet's detail panel (same Sheet chrome, same section
// styling), but keyed to a company rather than a person. Reads the same
// get-hubspot-company action the Prospects table's Company hover card
// uses, so opening a row here is a cache hit if it was already fetched.
function CompanySheet({ company, personas, onClose }: { company: OwnedCompany; personas: IcpPersona[]; onClose: () => void }) {
  const query = useHubSpotCompany(company.domain, company.name, true);
  const data = query.data;
  const hs = data?.company;

  const infoRows = [
    { label: "Industry", value: formatIndustry(company.industry) },
    { label: "Employees", value: formatEmployeeCount(company.employeeCount) },
    { label: "Domain", value: company.domain },
    { label: "Country", value: hs?.country ?? null },
    { label: "Company owner", value: hs?.companyOwnerName ?? null },
    { label: "xDR owner", value: hs?.xdrOwnerName ?? null },
  ];

  const openDeals = data?.openDeals ?? [];
  const closedLost = data?.closedLostDeals ?? [];
  const topProspects = data?.topProspects ?? [];

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent showClose={false} className="flex w-full flex-col gap-0 p-0 sm:max-w-lg overflow-hidden">
        <SheetHeader className="border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <CompanyLogo name={company.name} domain={company.domain} />
              <div className="min-w-0">
                <SheetTitle className="truncate text-sm font-semibold">{company.name}</SheetTitle>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {[formatIndustry(company.industry) !== "—" ? formatIndustry(company.industry) : null, company.domain]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted">
              <IconX size={16} />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {MATCHED_VIA_LABEL[company.matchedVia]}
            </span>
            {data?.recordUrl && (
              <a
                href={data.recordUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium no-underline"
                style={{ background: "rgba(255,122,89,0.15)", color: "#ff7a59" }}
              >
                HubSpot <IconExternalLink size={9} />
              </a>
            )}
            <QuickSearchPopover companyName={company.name} personas={personas} />
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <SheetSection icon={<IconBriefcase size={12} className="text-muted-foreground" />} label="Company">
            <div className="overflow-hidden rounded-lg border border-border divide-y divide-border bg-muted/20">
              {infoRows.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="shrink-0 text-[11px] text-muted-foreground">{row.label}</span>
                  <span className={cn("truncate text-right text-xs", row.value ? "text-foreground" : "text-muted-foreground/60")}>
                    {row.value ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          </SheetSection>

          {company.tags.length > 0 && (
            <SheetSection icon={<IconTag size={12} className="text-muted-foreground" />} label="Account attributes">
              <div className="flex flex-wrap gap-1.5">
                {company.tags.map((t) => (
                  <span
                    key={t.key}
                    className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", TAG_TONE_CLASS[t.tone])}
                  >
                    <span className="opacity-70">{t.label}:</span>
                    <span className="ml-1">{t.value.startsWith(`${t.label}: `) ? t.value.slice(t.label.length + 2) : t.value}</span>
                  </span>
                ))}
              </div>
            </SheetSection>
          )}

          {query.isLoading ? (
            <p className="flex items-center gap-1.5 pt-4 text-xs text-muted-foreground border-t border-border">
              <IconLoader2 size={12} className="animate-spin" /> Loading HubSpot data…
            </p>
          ) : !data?.connected ? (
            <p className="pt-4 text-xs text-muted-foreground border-t border-border">HubSpot isn't connected.</p>
          ) : !data.matched ? (
            <p className="pt-4 text-xs italic text-muted-foreground border-t border-border">
              This company wasn't found in HubSpot's company search, so deals and contacts couldn't be loaded.
            </p>
          ) : (
            <>
              <SheetSection icon={<IconCoin size={12} className="text-muted-foreground" />} label={`Open deals (${openDeals.length})`}>
                {openDeals.length === 0 ? (
                  <p className="text-xs italic text-muted-foreground/70">No open deals.</p>
                ) : (
                  <DealRows deals={openDeals} />
                )}
              </SheetSection>

              <SheetSection icon={<IconCoin size={12} className="text-muted-foreground" />} label={`Closed lost (${closedLost.length})`}>
                {closedLost.length === 0 ? (
                  <p className="text-xs italic text-muted-foreground/70">No closed-lost deals.</p>
                ) : (
                  <DealRows deals={closedLost} />
                )}
              </SheetSection>

              <SheetSection icon={<IconUsers size={12} className="text-muted-foreground" />} label={`Top prospects by activity (${topProspects.length})`}>
                {topProspects.length === 0 ? (
                  <p className="text-xs italic text-muted-foreground/70">No contacts on record at this company.</p>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-border divide-y divide-border bg-muted/20">
                    {topProspects.map((c, i) => (
                      <div key={i} className="px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-medium text-foreground">{c.name}</span>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <span className="text-[11px] text-muted-foreground">
                              {formatRelativeActivity(c.lastActivityAt) ?? "no activity"}
                            </span>
                            <a
                              href={contactLinkedInHref(c.name, company.name, c.linkedinUrl)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={c.linkedinUrl ? "Open LinkedIn profile" : "Search LinkedIn for this person"}
                              className="rounded p-0.5 text-muted-foreground/70 hover:bg-muted hover:text-[#0a66c2]"
                            >
                              <IconBrandLinkedin size={13} />
                            </a>
                            {c.hubspotUrl && (
                              <a
                                href={c.hubspotUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Open HubSpot contact record"
                                className="rounded p-0.5 text-muted-foreground/70 hover:bg-muted hover:text-[#ff7a59]"
                              >
                                <IconExternalLink size={12} />
                              </a>
                            )}
                          </div>
                        </div>
                        {(c.title || c.email) && (
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {[c.title, c.email].filter(Boolean).join(" · ")}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </SheetSection>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function MyAccounts() {
  const { data, isLoading, isFetching, refetch } = useActionQuery<MyOwnedAccountsData>("get-my-owned-accounts", {});
  const personasQuery = useActionQuery<{ personas: IcpPersona[] }>("list-icp-personas", {});
  const personas = personasQuery.data?.personas ?? [];
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<"all" | MatchedVia>("all");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const companies = data?.companies ?? [];

  // Filter pills are built from the tag values actually present in this
  // user's book of accounts, ordered by how many accounts carry each --
  // no hardcoded value lists, since these come from portal-specific
  // HubSpot properties.
  const tagFilterOptions = useMemo(() => {
    const counts = new Map<string, { value: string; tone: TagTone; count: number }>();
    for (const c of companies) {
      for (const t of c.tags) {
        if (!t.emphasis) continue;
        const existing = counts.get(t.value);
        if (existing) existing.count++;
        else counts.set(t.value, { value: t.value, tone: t.tone, count: 1 });
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)).slice(0, 8);
  }, [companies]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return companies.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q) && !(c.industry ?? "").toLowerCase().includes(q)) return false;
      if (tagFilter && !c.tags.some((t) => t.value === tagFilter)) return false;
      if (ownerFilter === "all") return true;
      // "both" counts as a match for either single-owner filter -- an
      // account you own in both roles is genuinely one of your Company-owner
      // accounts AND one of your xDR-owner accounts.
      if (ownerFilter === "companyOwner") return c.matchedVia === "companyOwner" || c.matchedVia === "both";
      if (ownerFilter === "xdrOwner") return c.matchedVia === "xdrOwner" || c.matchedVia === "both";
      return c.matchedVia === ownerFilter;
    });
  }, [companies, search, ownerFilter, tagFilter]);

  const hasActiveFilter = search.trim() !== "" || ownerFilter !== "all" || tagFilter !== null;
  function clearFilters() {
    setSearch("");
    setOwnerFilter("all");
    setTagFilter(null);
    setPage(1);
  }

  // Reset to page 1 whenever filters change, so a filtered set can't leave
  // you stranded on a page that no longer exists.
  const pageCount = Math.max(1, Math.ceil(filtered.length / ACCOUNTS_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * ACCOUNTS_PAGE_SIZE, safePage * ACCOUNTS_PAGE_SIZE);
  const selected = companies.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border">
        <div className="flex items-center justify-between px-4 py-3 min-h-[52px]">
          <div>
            <h1 className="text-sm font-semibold text-foreground">My Accounts</h1>
            <p className="text-xs text-muted-foreground">
              {isLoading
                ? "Loading…"
                : hasActiveFilter
                  ? `${filtered.length.toLocaleString()} of ${companies.length.toLocaleString()} match`
                  : `${companies.length.toLocaleString()} compan${companies.length === 1 ? "y" : "ies"} where you're the Company owner or xDR owner in HubSpot`}
              {data?.truncated ? ` — showing the first ${companies.length.toLocaleString()} of ${data.total.toLocaleString()}` : ""}
            </p>
          </div>
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
        </div>
      </div>

      {/* Filter bar */}
      {companies.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <div className="relative">
            <IconSearch size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search company or industry…"
              className="h-7 w-56 rounded-md border border-border bg-muted/40 pl-7 pr-3 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {search && (
              <button type="button" onClick={() => { setSearch(""); setPage(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <IconX size={11} />
              </button>
            )}
          </div>

          <div className="h-4 w-px bg-border" />

          <div className="flex items-center gap-1">
            <FilterPill active={ownerFilter === "all"} onClick={() => { setOwnerFilter("all"); setPage(1); }}>All accounts</FilterPill>
            <FilterPill
              active={ownerFilter === "companyOwner"}
              onClick={() => { setOwnerFilter(ownerFilter === "companyOwner" ? "all" : "companyOwner"); setPage(1); }}
            >
              Company owner
            </FilterPill>
            <FilterPill
              active={ownerFilter === "xdrOwner"}
              onClick={() => { setOwnerFilter(ownerFilter === "xdrOwner" ? "all" : "xdrOwner"); setPage(1); }}
            >
              xDR owner
            </FilterPill>
          </div>

          {tagFilterOptions.length > 0 && (
            <>
              <div className="h-4 w-px bg-border" />
              <div className="flex flex-wrap items-center gap-1">
                {tagFilterOptions.map((opt) => (
                  <FilterPill
                    key={opt.value}
                    active={tagFilter === opt.value}
                    onClick={() => { setTagFilter(tagFilter === opt.value ? null : opt.value); setPage(1); }}
                  >
                    <span className={cn("inline-block size-1.5 rounded-full", TAG_TONE_DOT[opt.tone])} />
                    {opt.value}
                    <span className="opacity-60">{opt.count}</span>
                  </FilterPill>
                ))}
              </div>
            </>
          )}

          {hasActiveFilter && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <IconLoader2 size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : !data?.connected ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-center">
            <IconBriefcase size={32} className="text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              HubSpot isn't connected.{" "}
              <Link to="/settings#hubspot" className="text-primary hover:underline">
                Connect it in Settings
              </Link>{" "}
              to see your owned accounts.
            </p>
          </div>
        ) : data.noOwnerRecord ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-center">
            <IconBriefcase size={32} className="text-muted-foreground/30" />
            <p className="max-w-sm text-sm text-muted-foreground">
              We couldn't find a HubSpot owner record matching your email. Ask an admin to confirm your HubSpot seat
              uses the same email you sign in here with.
            </p>
          </div>
        ) : data.error ? (
          <div className="flex h-48 items-center justify-center">
            <p className="text-sm text-destructive">{data.error}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-center">
            <IconBriefcase size={32} className="text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              {companies.length === 0
                ? "No companies are currently assigned to you as Company owner or xDR owner in HubSpot."
                : "No accounts match these filters"}
            </p>
            {hasActiveFilter && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs text-primary hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="sticky top-0 z-10 bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">Company</th>
                <th scope="col" className="sticky top-0 z-10 bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">Tags</th>
                <th scope="col" className="sticky top-0 z-10 bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">Owned via</th>
                <th scope="col" className="sticky top-0 z-10 bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">Industry</th>
                <th scope="col" className="sticky top-0 z-10 bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">Employees</th>
                <th scope="col" className="sticky top-0 z-10 bg-muted py-2 pl-3 pr-4 text-left text-xs font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className="group cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-muted/40"
                >
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2.5">
                      {/* max-w keeps the column width stable -- an
                          auto-layout table won't truncate without a cap. */}
                      <CompanyLogo name={c.name} domain={c.domain} />
                      <span className="max-w-[240px] truncate font-medium text-foreground">{c.name}</span>
                    </div>
                  </td>
                  {/* No stopPropagation -- the hover card is hover-only, so a
                      click here should still open the row's detail sheet. */}
                  <td className="px-3 py-3">
                    <TagsCell tags={c.tags} />
                  </td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {MATCHED_VIA_LABEL[c.matchedVia]}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-xs text-muted-foreground">{formatIndustry(c.industry)}</span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-xs text-muted-foreground tabular-nums">{formatEmployeeCount(c.employeeCount)}</span>
                  </td>
                  <td className="py-3 pl-3 pr-4" onClick={(e) => e.stopPropagation()}>
                    <QuickSearchPopover companyName={c.name} personas={personas} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {filtered.length > 0 && (
        <div className="flex items-center justify-end border-t border-border px-4 py-2">
          <Pagination page={safePage} pageSize={ACCOUNTS_PAGE_SIZE} totalCount={filtered.length} onPageChange={setPage} />
        </div>
      )}

      {selected && <CompanySheet company={selected} personas={personas} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
