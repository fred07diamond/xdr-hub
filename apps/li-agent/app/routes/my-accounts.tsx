import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { IconBriefcase, IconChevronDown, IconExternalLink, IconLoader2, IconRefresh, IconSearch, IconUsers, IconX } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { CompanyLogo } from "@/components/company-logo";
import { Pagination } from "@/components/Pagination";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { APP_TITLE } from "@/lib/app-config";
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

interface OwnedCompany {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employeeCount: string | null;
  matchedVia: MatchedVia;
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
// Persona entries go through generate-sales-nav-search.ts, which does the
// real translation of a persona's free-text criteria (icpText -- titles,
// seniority language) into actual Sales Nav filter chips, and takes the
// account's company name so the result stays scoped to this one account
// instead of every "Design Persona"-shaped lead on LinkedIn.
function QuickSearchPopover({ companyName, personas }: { companyName: string; personas: IcpPersona[] }) {
  const [open, setOpen] = useState(false);
  const [pendingPersonaId, setPendingPersonaId] = useState<string | null>(null);
  const generateSearch = useActionMutation("generate-sales-nav-search");

  async function handlePersonaClick(persona: IcpPersona) {
    setPendingPersonaId(persona.id);
    try {
      const result = (await generateSearch.mutateAsync({ prompt: persona.name, companyName })) as GenerateSearchResult;
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

export default function MyAccounts() {
  const { data, isLoading, isFetching, refetch } = useActionQuery<MyOwnedAccountsData>("get-my-owned-accounts", {});
  const personasQuery = useActionQuery<{ personas: IcpPersona[] }>("list-icp-personas", {});
  const personas = personasQuery.data?.personas ?? [];
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<"all" | MatchedVia>("all");
  const [page, setPage] = useState(1);

  const companies = data?.companies ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return companies.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q) && !(c.industry ?? "").toLowerCase().includes(q)) return false;
      if (ownerFilter === "all") return true;
      // "both" counts as a match for either single-owner filter -- an
      // account you own in both roles is genuinely one of your Company-owner
      // accounts AND one of your xDR-owner accounts.
      if (ownerFilter === "companyOwner") return c.matchedVia === "companyOwner" || c.matchedVia === "both";
      if (ownerFilter === "xdrOwner") return c.matchedVia === "xdrOwner" || c.matchedVia === "both";
      return c.matchedVia === ownerFilter;
    });
  }, [companies, search, ownerFilter]);

  const hasActiveFilter = search.trim() !== "" || ownerFilter !== "all";

  // Reset to page 1 whenever filters change, so a filtered set can't leave
  // you stranded on a page that no longer exists.
  const pageCount = Math.max(1, Math.ceil(filtered.length / ACCOUNTS_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * ACCOUNTS_PAGE_SIZE, safePage * ACCOUNTS_PAGE_SIZE);

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

          {hasActiveFilter && (
            <button
              type="button"
              onClick={() => { setSearch(""); setOwnerFilter("all"); setPage(1); }}
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
                onClick={() => { setSearch(""); setOwnerFilter("all"); setPage(1); }}
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
                <th scope="col" className="sticky top-0 z-10 bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">Owned via</th>
                <th scope="col" className="sticky top-0 z-10 bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">Industry</th>
                <th scope="col" className="sticky top-0 z-10 bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">Employees</th>
                <th scope="col" className="sticky top-0 z-10 bg-muted py-2 pl-3 pr-4 text-left text-xs font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((c) => (
                <tr key={c.id} className="group border-b border-border last:border-0 transition-colors hover:bg-muted/40">
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <CompanyLogo name={c.name} domain={c.domain} />
                      <span className="font-medium text-foreground truncate max-w-[220px]">{c.name}</span>
                    </div>
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
                  <td className="py-3 pl-3 pr-4">
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
    </div>
  );
}
