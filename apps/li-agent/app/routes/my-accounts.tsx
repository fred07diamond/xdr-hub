import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { IconBriefcase, IconChevronDown, IconExternalLink, IconLoader2, IconRefresh, IconSearch, IconX } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { CompanyLogo } from "@/components/company-logo";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `${APP_TITLE} — My Accounts` }];
}

interface OwnedCompany {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employeeCount: string | null;
}

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
// extension/content.js's comment on why the Lead tab specifically), pre-
// filled with the company name as a keyword so the xDR lands on a results
// page instead of a blank search.
function salesNavSearchHref(companyName: string): string {
  return `https://www.linkedin.com/sales/search/people?keywords=${encodeURIComponent(companyName)}`;
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

// Persona criteria (titles/seniority language) live only as free text on
// icpPersonas (icpText/summary) -- generate-sales-nav-search.ts already
// does the one real translation of that text into actual Sales Nav filter
// chips (Function/Seniority/etc), grounded by matching the persona's name.
// This just also passes the account's company name through so the result
// stays scoped to this one account instead of every "Design Persona"-
// shaped lead on LinkedIn.
function PersonaSearchPopover({ companyName, personas }: { companyName: string; personas: IcpPersona[] }) {
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

  if (personas.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted"
        >
          By persona <IconChevronDown size={10} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1.5">
        <p className="px-1.5 py-1 text-[11px] font-medium text-muted-foreground">Search {companyName} for…</p>
        <div className="grid gap-0.5">
          {personas.map((persona) => (
            <button
              key={persona.id}
              type="button"
              disabled={generateSearch.isPending}
              onClick={() => handlePersonaClick(persona)}
              className="flex items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50"
            >
              {pendingPersonaId === persona.id ? (
                <IconLoader2 size={10} className="shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <span style={{ background: persona.color }} className="inline-block size-1.5 shrink-0 rounded-full" />
              )}
              <span className="truncate">{persona.name}</span>
            </button>
          ))}
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

  const companies = data?.companies ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((c) => c.name.toLowerCase().includes(q) || (c.industry ?? "").toLowerCase().includes(q));
  }, [companies, search]);

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
                : `${companies.length.toLocaleString()} compan${companies.length === 1 ? "y" : "ies"} where you're the xDR Owner in HubSpot`}
              {data?.truncated ? ` (of ${data.total.toLocaleString()} total)` : ""}
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
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company or industry…"
              className="h-7 w-56 rounded-md border border-border bg-muted/40 pl-7 pr-3 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {search && (
              <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <IconX size={11} />
              </button>
            )}
          </div>
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
                ? "No companies are currently assigned to you as xDR Owner in HubSpot."
                : "No accounts match this search"}
            </p>
            {search && (
              <button type="button" onClick={() => setSearch("")} className="text-xs text-primary hover:underline">
                Clear search
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="sticky top-0 z-10 bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">Company</th>
                <th scope="col" className="sticky top-0 z-10 bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">Industry</th>
                <th scope="col" className="sticky top-0 z-10 bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">Employees</th>
                <th scope="col" className="sticky top-0 z-10 bg-muted py-2 pl-3 pr-4 text-left text-xs font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="group border-b border-border last:border-0 transition-colors hover:bg-muted/40">
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <CompanyLogo name={c.name} domain={c.domain} />
                      <span className="font-medium text-foreground truncate max-w-[220px]">{c.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-xs text-muted-foreground">{formatIndustry(c.industry)}</span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-xs text-muted-foreground tabular-nums">{formatEmployeeCount(c.employeeCount)}</span>
                  </td>
                  <td className="py-3 pl-3 pr-4">
                    <div className="flex items-center gap-1.5">
                      <a
                        href={salesNavSearchHref(c.name)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted"
                      >
                        <IconSearch size={11} /> Search on LinkedIn <IconExternalLink size={10} />
                      </a>
                      <PersonaSearchPopover companyName={c.name} personas={personas} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
