import {
  callAction,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";
import {
  IconAdjustmentsHorizontal,
  IconArrowLeft,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconCloudDownload,
  IconListDetails,
  IconLoader2,
  IconLock,
  IconPencil,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconRadar,
  IconRefresh,
  IconTrash,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ContactsTable } from "@/components/ContactsTable";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `${APP_TITLE} — Lists` }];
}

// ── Types ────────────────────────────────────────────────────────────────────

type Visibility = "private" | "public";
type RuleStatus = "active" | "paused";

interface SegmentListRow {
  id: string;
  name: string;
  ownerEmail: string;
  assignedToEmail: string | null;
  visibility: Visibility;
  personaId: string | null;
  status: string;
  lastRefreshedAt: string | null;
  createdAt: string | null;
  personaName: string | null;
  personaColor: string | null;
  contactCount: number;
  isActive: boolean;
  sourcingRuleId: string | null;
}

interface SegmentDetail {
  id: string;
  name: string;
  ownerEmail: string;
  assignedToEmail: string | null;
  visibility: Visibility;
  personaId: string | null;
  status: string;
  lastRefreshedAt: string | null;
  createdAt: string | null;
  owningSourcingRuleId: string | null;
  owningSourcingRuleName: string | null;
}

interface SegmentContact {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  email: string | null;
  personaMatchScore: number | null;
  companyFitScore: number | null;
  engagementScore: number | null;
  hubspotQlScore: number | null;
  commonRoomIntentScore: number | null;
  commonRoomCompanyFitScore: number | null;
  overallScore: number | null;
  scoreReasoning: string | null;
  status: "active" | "actioned";
  linkedinUrl: string | null;
  hubspotUrl: string | null;
  source: "hubspot" | "commonroom" | "prospector";
}

interface PersonaOption {
  id: string;
  name: string;
  color: string | null;
}

interface SubPersonaOption {
  id: string;
  personaId: string;
  name: string;
}

interface IcpOption {
  id: string;
  name: string;
  product: string | null;
}

// ── HubSpot owner-browse (feeds the company tag input directly — see
// BrowseByOwnerPopover below; no separate saved-entity/page, per Fred's
// explicit "I don't need an entire page for this, just let me add the
// company like a tag" feedback) ─────────────────────────────────────────────

interface HubSpotOwnerOption {
  id: string;
  name: string;
}

type MatchedVia = "companyOwner" | "xdrOwner" | "both";

interface HubSpotOwnedCompany {
  id: string;
  name: string;
  domain: string | null;
  matchedVia: MatchedVia;
}

function MatchedViaBadge({ matchedVia }: { matchedVia: MatchedVia }) {
  const label =
    matchedVia === "both" ? "Both" : matchedVia === "xdrOwner" ? "xDR Owner" : "Company Owner";
  const colorClasses =
    matchedVia === "both"
      ? "bg-green-500/10 text-green-600 dark:text-green-400"
      : matchedVia === "xdrOwner"
        ? "bg-violet-500/10 text-violet-600 dark:text-violet-400"
        : "bg-sky-500/10 text-sky-600 dark:text-sky-400";
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${colorClasses}`}>
      {label}
    </span>
  );
}

// Compact popover, anchored to the company tag input itself — pick a real
// HubSpot owner (an AE via "Company owner", or an XDR via the custom
// "xDR Owner" property; both are OR'd, and the checklist shows which one
// matched), check the companies you want, and they're added directly as
// tags in the SAME field a manually-typed company goes into. No separate
// saved list, no separate page — this is genuinely just a faster way to
// fill in the tag input.
function BrowseByOwnerPopover({ onAdd }: { onAdd: (companyNames: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const { data: ownersData, isLoading: ownersLoading } = useActionQuery(
    "search-hubspot-company-owners",
    {},
    { enabled: open },
  );
  const ownersResult = ownersData as
    | { owners?: HubSpotOwnerOption[]; notConnected?: boolean; error?: string | null }
    | undefined;
  const owners: HubSpotOwnerOption[] = ownersResult?.owners ?? [];
  const ownersNotConnected = ownersResult?.notConnected === true;
  const ownersFetchError = ownersResult?.error ?? null;

  const [ownerQuery, setOwnerQuery] = useState("");
  const [showOwnerSuggestions, setShowOwnerSuggestions] = useState(false);
  const [selectedOwner, setSelectedOwner] = useState<HubSpotOwnerOption | null>(null);
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<Set<string>>(new Set());
  const [companyQuery, setCompanyQuery] = useState("");

  const { data: companiesData, isLoading: companiesLoading, error: companiesError } = useActionQuery(
    "search-hubspot-companies-by-owner",
    { ownerId: selectedOwner?.id ?? "" },
    { enabled: !!selectedOwner },
  );
  const companiesResult = companiesData as
    | { companies?: HubSpotOwnedCompany[]; total?: number; truncated?: boolean }
    | undefined;
  const companies: HubSpotOwnedCompany[] = companiesResult?.companies ?? [];
  const companiesTruncated = companiesResult?.truncated ?? false;
  const companiesTotal = companiesResult?.total ?? companies.length;
  // Client-side filter over the fetched page only — this owner's companies
  // are all already loaded in one call (search-hubspot-companies-by-owner
  // has no server-side search param), so this narrows what's ALREADY here
  // rather than re-querying. Still genuinely useful even when truncated
  // (see the banner below) — it's strictly better than no way to search at
  // all across up to 100 rows.
  const filteredCompanies = companies.filter((c) =>
    c.name.toLowerCase().includes(companyQuery.trim().toLowerCase()),
  );

  const filteredOwners = owners.filter((o) =>
    o.name.toLowerCase().includes(ownerQuery.trim().toLowerCase()),
  );
  const allFilteredSelected =
    filteredCompanies.length > 0 && filteredCompanies.every((c) => selectedCompanyIds.has(c.id));

  function reset() {
    setOwnerQuery("");
    setShowOwnerSuggestions(false);
    setSelectedOwner(null);
    setSelectedCompanyIds(new Set());
    setCompanyQuery("");
  }

  function pickOwner(owner: HubSpotOwnerOption) {
    setSelectedOwner(owner);
    setOwnerQuery(owner.name);
    setShowOwnerSuggestions(false);
    setSelectedCompanyIds(new Set());
    setCompanyQuery("");
  }

  function toggleCompany(id: string) {
    setSelectedCompanyIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Operates on whatever the search box currently narrows to, not the full
  // fetched page — "Select all" after typing "acme" selects only the
  // filtered Acme-matching rows, not everything this owner has.
  function toggleSelectAll() {
    setSelectedCompanyIds((prev) => {
      if (allFilteredSelected) {
        const next = new Set(prev);
        filteredCompanies.forEach((c) => next.delete(c.id));
        return next;
      }
      const next = new Set(prev);
      filteredCompanies.forEach((c) => next.add(c.id));
      return next;
    });
  }

  function handleAdd() {
    const chosen = companies.filter((c) => selectedCompanyIds.has(c.id)).map((c) => c.name);
    if (chosen.length === 0) return;
    onAdd(chosen);
    setOpen(false);
    reset();
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <IconCloudDownload size={12} />
          Browse by owner
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="start" sideOffset={6}>
        {selectedOwner && (
          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <button
              type="button"
              onClick={() => {
                setSelectedOwner(null);
                setSelectedCompanyIds(new Set());
                setOwnerQuery("");
                setShowOwnerSuggestions(false);
                setCompanyQuery("");
              }}
              className="rounded p-1 text-muted-foreground hover:bg-muted"
              aria-label="Back"
            >
              <IconArrowLeft size={14} />
            </button>
            <span className="text-xs font-medium text-foreground">{selectedOwner.name}'s companies</span>
          </div>
        )}

        <div className="max-h-72 overflow-y-auto p-3">
          {!selectedOwner ? (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Owner (Company owner or xDR Owner)
              </label>
              {ownersLoading ? (
                <div className="flex h-9 items-center text-xs text-muted-foreground">
                  <IconLoader2 size={13} className="mr-1.5 animate-spin" /> Loading HubSpot owners…
                </div>
              ) : ownersFetchError ? (
                <p className="text-xs text-destructive">Couldn't load HubSpot owners: {ownersFetchError}.</p>
              ) : owners.length === 0 && ownersNotConnected ? (
                <p className="text-xs text-muted-foreground/60">
                  HubSpot isn't connected — connect it to browse by owner.
                </p>
              ) : owners.length === 0 ? (
                <p className="text-xs text-muted-foreground/60">No HubSpot owners found.</p>
              ) : (
                <div className="relative">
                  <input
                    autoFocus
                    value={ownerQuery}
                    onChange={(e) => {
                      setOwnerQuery(e.target.value);
                      setShowOwnerSuggestions(true);
                    }}
                    onFocus={() => setShowOwnerSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowOwnerSuggestions(false), 150)}
                    placeholder="Search owners…"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  {showOwnerSuggestions && filteredOwners.length > 0 && (
                    <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
                      {filteredOwners.map((owner) => (
                        <button
                          key={owner.id}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            pickOwner(owner);
                          }}
                          className="flex w-full items-center px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted"
                        >
                          {owner.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : companiesLoading ? (
            <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
              <IconLoader2 size={16} className="mr-1.5 animate-spin" /> Loading companies…
            </div>
          ) : companiesError ? (
            <p className="text-xs text-destructive">
              {errorMessage(companiesError, "Couldn't load companies for this owner.")}
            </p>
          ) : companies.length === 0 ? (
            <p className="text-xs text-muted-foreground/60">{selectedOwner.name} has no companies in HubSpot.</p>
          ) : (
            <div>
              <input
                autoFocus
                value={companyQuery}
                onChange={(e) => setCompanyQuery(e.target.value)}
                placeholder={`Search ${selectedOwner.name}'s companies…`}
                className="mb-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {companiesTruncated && (
                <p className="mb-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                  Showing the first {companies.length} of {companiesTotal.toLocaleString()} companies —
                  "Select all" won't cover this owner's full book of business.
                </p>
              )}
              {filteredCompanies.length === 0 ? (
                <p className="py-2 text-xs text-muted-foreground/60">No companies match "{companyQuery}".</p>
              ) : (
                <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                  {filteredCompanies.map((c) => (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 rounded px-1.5 py-1 text-xs text-foreground hover:bg-muted/50"
                    >
                      <input
                        type="checkbox"
                        checked={selectedCompanyIds.has(c.id)}
                        onChange={() => toggleCompany(c.id)}
                        className="size-3.5 shrink-0 rounded border-border"
                      />
                      <span className="min-w-0 flex-1 truncate" title={c.name}>
                        {c.name}
                      </span>
                      <MatchedViaBadge matchedVia={c.matchedVia} />
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {selectedOwner && filteredCompanies.length > 0 && (
          <div className="flex items-center justify-between border-t border-border px-3 py-2">
            <button
              type="button"
              onClick={toggleSelectAll}
              className="text-[11px] font-medium text-primary hover:underline"
            >
              {allFilteredSelected ? "Deselect all" : "Select all"}
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={selectedCompanyIds.size === 0}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-40"
            >
              <IconCheck size={12} />
              Add {selectedCompanyIds.size || ""}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

interface SourcingRule {
  id: string;
  name: string;
  ownerEmail: string;
  personaId: string;
  subPersonaId: string | null;
  icpId: string | null;
  companyAllowList: string | null;
  companyDenyList: string | null;
  manualTitleKeywords: string | null;
  manualSeniorities: string | null;
  minLinkedinFollowers: number | null;
  previousCompanyName: string | null;
  desiredVolume: number;
  // Legacy schedule fields — kept only for display fallback on pre-migration
  // rows that predate intervalHours (local dev only; never null in prod).
  readyByTime: string;
  leadHours: number;
  intervalHours: number | null;
  segmentId: string;
  jobResourcePath: string | null;
  status: RuleStatus;
  createdAt: string | null;
  personaName: string | null;
  subPersonaName: string | null;
  icpName: string | null;
  contactCount: number;
}

// Run History (Fred's "where is this pulling from, and I need to be able to
// track that — I need to see progression" ask): one row per
// run-sourcing-rule-pipeline.ts invocation, from list-sourcing-rule-runs.ts.
// Older rows written before checkpoint instrumentation shipped won't have
// most of these fields at all — every field below except id/source/status/
// startedAt is optional/nullable for exactly that reason.
interface SourcingRuleRun {
  id: string;
  source: "hubspot" | "commonroom" | "notion" | "gdocs" | "prospector";
  status: "success" | "failed" | "running";
  startedAt: string | null;
  completedAt: string | null;
  recordsPulled: number | null;
  error: string | null;
  imported?: number;
  scored?: number;
  deduped?: number;
  alreadyKnown?: number;
  scoringErrorCount?: number;
  companiesConsidered?: number;
  icpQualifiedZeroCompanies?: boolean;
  phase?: string;
  recordsFound?: number;
}

// Live progress for an in-flight "Find prospects now" run — populated from
// each run-sourcing-rule-pipeline.ts invocation's own response as the
// client-side auto-continuation loop (handleRunSourcingRule) calls it
// repeatedly. Deliberately a small subset of that action's full response
// (just enough to render a meaningful button label) rather than the whole
// payload.
interface SourcingRunProgress {
  phase: "searching" | "scoring" | "complete";
  recordsFound: number;
  scored: number;
  remaining: number;
}

// Turns a single in-flight progress snapshot into the button's label — e.g.
// "Searching… (340 found)" while still paging Prospector, "Scoring
// 120/340…" once search has handed off to per-contact scoring.
function buildSourcingRunLabel(progress: SourcingRunProgress | null): string {
  if (!progress) return "Finding prospects…";
  if (progress.phase === "scoring") {
    const total = progress.scored + progress.remaining;
    return total > 0 ? `Scoring ${progress.scored}/${total}…` : "Scoring…";
  }
  return progress.recordsFound > 0 ? `Searching… (${progress.recordsFound} found)` : "Searching…";
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Only these values divide evenly into 24, guaranteeing a predictable,
// non-drifting recurring schedule — kept in sync with computeIntervalCron's
// validation on the server.
const INTERVAL_HOURS_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "Every hour" },
  { value: 2, label: "Every 2 hours" },
  { value: 3, label: "Every 3 hours" },
  { value: 4, label: "Every 4 hours" },
  { value: 6, label: "Every 6 hours" },
  { value: 8, label: "Every 8 hours" },
  { value: 12, label: "Every 12 hours" },
  { value: 24, label: "Once a day (24 hours)" },
];

// Kept in sync with derive-prospector-filters.ts's server-side
// SENIORITY_LEVELS — the same fixed vocabulary the LLM-derived filter is
// constrained to, so a manual override picks from the same set of values
// the auto-derived path could have produced.
const SENIORITY_LEVELS = ["Intern", "Junior IC", "Senior IC", "Manager", "Director", "VP", "C-Level"];

function parseFollowerCount(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

function TagChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="text-muted-foreground hover:text-foreground"
        aria-label={`Remove ${label}`}
      >
        <IconX size={11} />
      </button>
    </span>
  );
}

// Generic multi-value chip entry — type text, press Enter or "," to commit
// it as a chip; Backspace on an empty input removes the last chip; click a
// chip's × to remove it directly. Case-insensitive dedup on commit. Replaces
// a raw comma-separated text field per Fred's explicit ask for a
// CommonRoom-like tagging UI instead of typing a delimited string.
function TagInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState("");

  function commit(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (!values.some((v) => v.toLowerCase() === trimmed.toLowerCase())) {
      onChange([...values, trimmed]);
    }
    setText("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(text);
    } else if (e.key === "Backspace" && text === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring">
      {values.map((v, i) => (
        <TagChip key={`${v}-${i}`} label={v} onRemove={() => onChange(values.filter((_, idx) => idx !== i))} />
      ))}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => commit(text)}
        placeholder={values.length === 0 ? placeholder : undefined}
        className="min-w-[80px] flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
      />
    </div>
  );
}

// Company chip entry backed by a live HubSpot company search
// (search-hubspot-companies.ts — calls HubSpot's Companies Search API
// directly, so it finds any real HubSpot company, not just ones with an
// already-synced contact; falls back to this app's own synced-contact
// company names if HubSpot isn't connected or the live call fails) — per
// Fred's explicit ask to search/pick real known companies rather than
// retyping them blind. Still allows committing a raw typed name via Enter
// for a company not yet in HubSpot at all, same as TagInput — search only
// ever suggests, never constrains what can be added.
function CompanyTagInput({
  values,
  onChange,
  placeholder,
  allowOwnerBrowse,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  // Only meaningful for an ALLOW-list usage — "browse who owns this
  // company" doesn't make sense for a deny-list, so callers opt in
  // explicitly rather than this defaulting on everywhere CompanyTagInput
  // is used.
  allowOwnerBrowse?: boolean;
}) {
  const [text, setText] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(text.trim()), 200);
    return () => clearTimeout(handle);
  }, [text]);

  const { data } = useActionQuery(
    "search-hubspot-companies",
    { query: debouncedQuery },
    { enabled: debouncedQuery.length >= 2 },
  );
  const suggestions: string[] = ((data as { companies?: string[] } | undefined)?.companies ?? []).filter(
    (c) => !values.some((v) => v.toLowerCase() === c.toLowerCase()),
  );

  function commit(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (!values.some((v) => v.toLowerCase() === trimmed.toLowerCase())) {
      onChange([...values, trimmed]);
    }
    setText("");
    setShowSuggestions(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(text);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    } else if (e.key === "Backspace" && text === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  function addFromOwnerBrowse(companyNames: string[]) {
    const merged = [...values];
    for (const name of companyNames) {
      if (!merged.some((v) => v.toLowerCase() === name.toLowerCase())) merged.push(name);
    }
    onChange(merged);
  }

  return (
    <div>
      <div className="relative">
        <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring">
          {values.map((v, i) => (
            <TagChip key={`${v}-${i}`} label={v} onRemove={() => onChange(values.filter((_, idx) => idx !== i))} />
          ))}
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={handleKeyDown}
            // Delay hiding so a suggestion button's onMouseDown still fires
            // before blur would otherwise unmount the dropdown first.
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder={values.length === 0 ? placeholder : undefined}
            className="min-w-[80px] flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
          />
        </div>
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(s);
                }}
                className="flex w-full items-center px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
      {allowOwnerBrowse && (
        <div className="mt-1">
          <BrowseByOwnerPopover onAdd={addFromOwnerBrowse} />
        </div>
      )}
    </div>
  );
}

// Shared manual-filter controls for both the New Active List and Edit Rule
// panels — lets an XDR go as broad or as specific as they want on the
// CommonRoom Prospector search itself, instead of being limited to whatever
// a single LLM call inferred from the persona doc (derive-prospector-
// filters.ts). Title keywords/seniority REPLACE the auto-derived value when
// set (see run-sourcing-rule-pipeline.ts's startFreshAndSearch); follower
// count/previous company are purely additive narrowing filters with no
// auto-derived equivalent. Collapsed by default (progressive disclosure —
// most rules never need this), since the persona-driven defaults already
// cover the common case.
function AdvancedProspectorFilters({
  titleKeywords,
  onTitleKeywordsChange,
  selectedSeniorities,
  onToggleSeniority,
  minFollowersText,
  onMinFollowersChange,
  previousCompanyName,
  onPreviousCompanyNameChange,
}: {
  titleKeywords: string[];
  onTitleKeywordsChange: (next: string[]) => void;
  selectedSeniorities: Set<string>;
  onToggleSeniority: (level: string) => void;
  minFollowersText: string;
  onMinFollowersChange: (v: string) => void;
  previousCompanyName: string;
  onPreviousCompanyNameChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const activeCount =
    (titleKeywords.length > 0 ? 1 : 0) +
    (selectedSeniorities.size > 0 ? 1 : 0) +
    (minFollowersText.trim() ? 1 : 0) +
    (previousCompanyName.trim() ? 1 : 0);

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <IconAdjustmentsHorizontal size={14} className="text-muted-foreground" />
        <span className="flex-1 text-xs font-medium text-foreground">Advanced Prospector filters</span>
        {activeCount > 0 && (
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {activeCount}
          </span>
        )}
        {open ? (
          <IconChevronDown size={14} className="text-muted-foreground" />
        ) : (
          <IconChevronRight size={14} className="text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="flex flex-col gap-4 border-t border-border p-3">
          <p className="text-[11px] text-muted-foreground/70">
            By default, title and seniority are auto-derived from the persona. Set either below to take direct
            control instead — go broader (fewer/looser keywords) or narrower (more specific ones) than the
            auto-derived guess.
          </p>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Title keywords (optional override)
            </label>
            <TagInput
              values={titleKeywords}
              onChange={onTitleKeywordsChange}
              placeholder="Type a title, press Enter…"
            />
            <p className="mt-1 text-[11px] text-muted-foreground/60">
              Matches ANY of these (broadens the search) — replaces the auto-derived keyword.
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Seniority (optional override)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {SENIORITY_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => onToggleSeniority(level)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    selectedSeniorities.has(level)
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground/60">
              Pick one or more — replaces the auto-derived seniority when any are selected.
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Minimum LinkedIn followers (optional)
            </label>
            <input
              type="number"
              min={0}
              value={minFollowersText}
              onChange={(e) => onMinFollowersChange(e.target.value)}
              placeholder="e.g. 500"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Previous company (optional)
            </label>
            <input
              value={previousCompanyName}
              onChange={(e) => onPreviousCompanyNameChange(e.target.value)}
              placeholder="e.g. Google"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="mt-1 text-[11px] text-muted-foreground/60">Finds people who previously worked there.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(iso: string | null) {
  if (!iso) return "Never refreshed";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Never refreshed";
  const diffMs = Math.max(0, Date.now() - then);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Refreshed just now";
  if (minutes < 60) return `Refreshed ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Refreshed ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Refreshed ${days}d ago`;
  return `Refreshed ${new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

// A request that times out at the hosting platform's infrastructure layer
// (a load balancer or edge proxy, not this app's own server code) can come
// back as a raw HTML error page instead of a JSON action error — callAction
// surfaces that page's full markup as `err.message` verbatim. Detect that
// case and show a clean, actionable message instead of dumping raw HTML
// into the UI.
function errorMessage(err: unknown, fallback: string) {
  const message = err instanceof Error ? err.message : "";
  if (/<(!doctype|html)[\s>]/i.test(message)) {
    return "This took too long and timed out — try again, or lower the desired volume for a faster run.";
  }
  return message || fallback;
}

function safeParseList(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

function sameList(a: string[], b: string[]) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Section header used to group the New Active List / Edit Rule panels' many
// fields into "what am I actually configuring here" chunks — same uppercase-
// label style already used elsewhere on this page (e.g. "Automation").
function FormSectionHeader({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-0.5 mt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}

// ── Small UI bits ────────────────────────────────────────────────────────────

function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  const isPublic = visibility === "public";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
        isPublic
          ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {isPublic ? "Public" : "Private"}
    </span>
  );
}

// Deliberately a different color scheme from VisibilityBadge (violet/amber
// vs. sky/muted) so Static/Active never gets visually confused with
// Private/Public — the two are unrelated axes on the same list.
function ListTypeBadge({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
        isActive
          ? "bg-violet-500/10 text-violet-600 dark:text-violet-400"
          : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
      }`}
    >
      {isActive ? "Active" : "Static"}
    </span>
  );
}

function PersonaBadge({ name, color }: { name: string; color: string | null }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-foreground">
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: color ?? "#6366f1" }}
      />
      <span className="truncate">{name}</span>
    </span>
  );
}

function StatusBadge({ status }: { status: RuleStatus }) {
  const isActive = status === "active";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
        isActive
          ? "bg-green-500/10 text-green-600 dark:text-green-400"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {isActive ? "Running" : "Paused"}
    </span>
  );
}

// ── Recent runs (run history) ───────────────────────────────────────────────

// A run genuinely still in progress should complete (or get killed by the
// hosting platform's own infrastructure timeout) well within this window —
// used to distinguish a "running" row that's actually still going from one
// that's stuck (the platform killed the process mid-flight, and the row was
// simply left in "running" at whatever its last completed checkpoint was).
const RUN_TIMED_OUT_AFTER_MS = 6 * 60_000;

type DerivedRunStatus = "success" | "failed" | "timedOut" | "running";

function deriveRunStatus(run: SourcingRuleRun): DerivedRunStatus {
  if (run.status === "success") return "success";
  if (run.status === "failed") return "failed";
  // run.status === "running" — the only status left to disambiguate.
  const startedMs = run.startedAt ? new Date(run.startedAt).getTime() : NaN;
  const isStale = !Number.isNaN(startedMs) && Date.now() - startedMs > RUN_TIMED_OUT_AFTER_MS;
  return isStale ? "timedOut" : "running";
}

function formatRunTimestamp(iso: string | null) {
  if (!iso) return "Unknown time";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Unknown time";
  const diffMs = Math.max(0, Date.now() - then);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

// Builds the compact outcome summary shown next to each run — e.g.
// "12 found · 8 scored, 3 new, 5 already known, 2 deduped" for a success, or
// "12 found, 8 scored" for a still-partial timed-out run. Any count that's
// missing/zero (a run that died before even reaching that checkpoint) is
// simply omitted rather than shown as a misleading "0 found". `imported` and
// `alreadyKnown` are surfaced explicitly (not just `found`/`scored`) because
// re-running a rule with no fresh CommonRoom inventory legitimately re-finds
// mostly-the-same people every time — "12 found · 8 scored" alone reads as
// forward progress even when 0 of those 12 were actually new.
function buildRunSummary(run: SourcingRuleRun, derived: DerivedRunStatus): string {
  const foundCount = derived === "success" ? run.recordsPulled ?? undefined : run.recordsFound;
  const parts: string[] = [];
  if (foundCount) parts.push(`${foundCount} found`);
  if (run.scored) parts.push(`${run.scored} scored`);
  const base = parts.length > 0 ? parts.join(" · ") : "No progress recorded";
  const extras: string[] = [];
  // A run's `imported` count only means "genuinely new" under the fixed
  // resolveContact classification, which also always writes `alreadyKnown`
  // to metadata. A run recorded before that fix has `alreadyKnown`
  // undefined and its `imported` value conflated new + same-source
  // rematches — labeling it "N new" would retroactively apply a meaning the
  // run never actually measured. Gate the new/already-known pair on
  // `alreadyKnown !== undefined` so only runs that ran under the fixed code
  // get this more specific breakdown; older rows fall back to the original
  // found/scored/deduped summary they always had.
  if (run.alreadyKnown !== undefined) {
    if (run.imported && run.imported > 0) extras.push(`${run.imported} new`);
    if (run.alreadyKnown > 0) extras.push(`${run.alreadyKnown} already known`);
  }
  if (run.deduped && run.deduped > 0) extras.push(`${run.deduped} deduped`);
  if (run.scoringErrorCount && run.scoringErrorCount > 0) {
    extras.push(`${run.scoringErrorCount} error${run.scoringErrorCount === 1 ? "" : "s"}`);
  }
  return extras.length > 0 ? `${base}, ${extras.join(", ")}` : base;
}

function RunStatusIcon({ derived }: { derived: DerivedRunStatus }) {
  if (derived === "success") return <IconCircleCheck size={14} className="text-green-600 dark:text-green-400" />;
  if (derived === "failed" || derived === "timedOut") return <IconCircleX size={14} className="text-destructive" />;
  return (
    <span className="relative flex size-3.5 items-center justify-center">
      <span className="absolute inline-flex size-2 animate-ping rounded-full bg-sky-500/70" />
      <span className="relative inline-flex size-1.5 rounded-full bg-sky-500" />
    </span>
  );
}

function RunRow({ run }: { run: SourcingRuleRun }) {
  const derived = deriveRunStatus(run);

  return (
    <div className="flex items-start gap-2.5 px-4 py-2">
      <div className="mt-0.5 shrink-0">
        <RunStatusIcon derived={derived} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5 text-xs">
          <span className="font-medium text-foreground">CommonRoom Prospector</span>
          <span className="text-muted-foreground/60">·</span>
          <span className="text-muted-foreground">{formatRunTimestamp(run.startedAt)}</span>
        </div>
        {derived === "success" && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">{buildRunSummary(run, derived)}</p>
        )}
        {derived === "timedOut" && (
          <p className="mt-0.5 text-[11px] text-destructive">Timed out · {buildRunSummary(run, derived)}</p>
        )}
        {derived === "failed" && (
          <p className="mt-0.5 line-clamp-2 text-[11px] text-destructive" title={run.error ?? undefined}>
            {run.error ?? "Failed"}
          </p>
        )}
        {derived === "running" && (
          <p className="mt-0.5 text-[11px] text-sky-600 dark:text-sky-400">Running…</p>
        )}
      </div>
    </div>
  );
}

function RecentRunsSection({ ruleId }: { ruleId: string }) {
  // Collapsed by default — same disclosure pattern as "Advanced Prospector
  // filters" above. A rule running every few hours accumulates run rows
  // fast (each one ~3 lines tall), pushing the actual contact table below
  // the fold; the collapsed header still surfaces the single most recent
  // run's status/summary at a glance, so nothing important is hidden by
  // default, only the historical tail.
  const [open, setOpen] = useState(false);
  const { data } = useActionQuery(
    "list-sourcing-rule-runs",
    { ruleId },
    { refetchInterval: 30000, staleTime: 25000 },
  );
  const runs: SourcingRuleRun[] = (data as { runs?: SourcingRuleRun[] })?.runs ?? [];
  const latest = runs[0];
  const latestDerived = latest ? deriveRunStatus(latest) : null;

  return (
    <div className="border-b border-border py-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left"
      >
        <h2 className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Recent runs
        </h2>
        {latest && latestDerived && (
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <RunStatusIcon derived={latestDerived} />
            <span className="truncate">{formatRunTimestamp(latest.startedAt)}</span>
          </span>
        )}
        <span className="flex-1" />
        {runs.length > 0 && <span className="text-[11px] text-muted-foreground/60">{runs.length}</span>}
        {open ? (
          <IconChevronDown size={14} className="shrink-0 text-muted-foreground" />
        ) : (
          <IconChevronRight size={14} className="shrink-0 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="pb-2">
          {runs.length === 0 ? (
            <p className="px-4 text-xs text-muted-foreground/60">No runs yet</p>
          ) : (
            <div className="flex flex-col divide-y divide-border/60">
              {runs.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── List card (list view) ────────────────────────────────────────────────────

function ListCard({
  list,
  onOpen,
}: {
  list: SegmentListRow;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-ring"
      style={list.personaColor ? { borderTop: `4px solid ${list.personaColor}` } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {list.name}
        </p>
        <IconChevronRight size={14} className="mt-0.5 shrink-0 text-muted-foreground/40" />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <ListTypeBadge isActive={list.isActive} />
        <VisibilityBadge visibility={list.visibility} />
        {list.personaName && (
          <PersonaBadge name={list.personaName} color={list.personaColor} />
        )}
      </div>

      <div className="mt-auto flex items-center gap-1.5 text-xs text-muted-foreground">
        <IconUsers size={13} />
        {list.contactCount.toLocaleString()} contact{list.contactCount === 1 ? "" : "s"}
      </div>

      {list.assignedToEmail && (
        <p className="truncate text-[11px] text-muted-foreground/70">
          Assigned to {list.assignedToEmail}
        </p>
      )}

      <p className="text-[11px] text-muted-foreground/50">
        {formatRelativeTime(list.lastRefreshedAt)}
      </p>
    </button>
  );
}

// ── New list flow ────────────────────────────────────────────────────────────

type NewListType = "static" | "active";

function NewListTypeChoice({
  onClose,
  onChoose,
}: {
  onClose: () => void;
  onChoose: (type: NewListType) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">New list</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted">
            <IconX size={16} />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onChoose("static")}
            className="flex flex-col items-start gap-2 rounded-xl border border-border p-4 text-left transition-colors hover:border-ring hover:bg-muted/30"
          >
            <IconLock size={20} className="text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">Static list</p>
            <p className="text-xs text-muted-foreground">
              Manually curated from a persona and a minimum match score. Contacts only change when you refresh it.
            </p>
          </button>
          <button
            type="button"
            onClick={() => onChoose("active")}
            className="flex flex-col items-start gap-2 rounded-xl border border-border p-4 text-left transition-colors hover:border-ring hover:bg-muted/30"
          >
            <IconRadar size={20} className="text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">Active list</p>
            <p className="text-xs text-muted-foreground">
              Automatically finds and adds new prospects on a schedule, targeting a persona and companies you choose.
            </p>
          </button>
        </div>
      </div>
    </div>
  );
}

function NewSegmentPanel({
  onClose,
  onCreated,
  onBack,
}: {
  onClose: () => void;
  onCreated: () => void;
  onBack: () => void;
}) {
  const { data: personaData, isLoading: personasLoading } = useActionQuery(
    "list-personas",
    {},
  );
  const personas: PersonaOption[] =
    (personaData as { personas?: PersonaOption[] })?.personas ?? [];

  const createSegment = useActionMutation("create-segment");

  const [name, setName] = useState("");
  const [personaId, setPersonaId] = useState("");
  const [minScore, setMinScore] = useState(50);
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed || !personaId) return;
    try {
      await createSegment.mutateAsync({
        name: trimmed,
        personaId,
        minPersonaMatchScore: minScore,
        visibility,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Couldn't create list."));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <button type="button" onClick={onBack} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Back">
            <IconArrowLeft size={16} />
          </button>
          <h2 className="flex-1 text-sm font-semibold text-foreground">New static list</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted">
            <IconX size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Q3 outbound — VP Eng"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Persona</label>
            {personasLoading ? (
              <div className="flex h-9 items-center text-xs text-muted-foreground">
                <IconLoader2 size={13} className="mr-1.5 animate-spin" /> Loading personas…
              </div>
            ) : personas.length === 0 ? (
              <p className="text-xs text-muted-foreground/60">
                No personas yet — create one on the Personas page first.
              </p>
            ) : (
              <select
                value={personaId}
                onChange={(e) => setPersonaId(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="" disabled>
                  Select a persona…
                </option>
                {personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Minimum persona match score
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={minScore}
              onChange={(e) => {
                const v = Number(e.target.value);
                setMinScore(Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0);
              }}
              className="w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Visibility</label>
            <div className="inline-flex rounded-lg border border-border p-0.5">
              {(["private", "public"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVisibility(v)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                    visibility === v
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!name.trim() || !personaId || createSegment.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            {createSegment.isPending && <IconLoader2 size={12} className="animate-spin" />}
            Create list
          </button>
        </div>
      </div>
    </div>
  );
}

function NewActiveListPanel({
  onClose,
  onCreated,
  onBack,
}: {
  onClose: () => void;
  onCreated: () => void;
  onBack: () => void;
}) {
  const { data: personaData, isLoading: personasLoading } = useActionQuery(
    "list-personas",
    {},
  );
  const personas: PersonaOption[] =
    (personaData as { personas?: PersonaOption[] })?.personas ?? [];

  const { data: icpData, isLoading: icpsLoading } = useActionQuery(
    "list-icps",
    {},
  );
  const icps: IcpOption[] =
    (icpData as { icps?: IcpOption[] })?.icps ?? [];

  const createSourcingRule = useActionMutation("create-sourcing-rule");

  const [name, setName] = useState("");
  const [personaId, setPersonaId] = useState("");
  const [subPersonaId, setSubPersonaId] = useState("");
  const [icpId, setIcpId] = useState("");
  const [allowList, setAllowList] = useState<string[]>([]);
  const [denyList, setDenyList] = useState<string[]>([]);
  const [desiredVolume, setDesiredVolume] = useState(20);
  const [intervalHours, setIntervalHours] = useState<number | "">("");
  const [titleKeywords, setTitleKeywords] = useState<string[]>([]);
  const [selectedSeniorities, setSelectedSeniorities] = useState<Set<string>>(new Set());
  const [minFollowersText, setMinFollowersText] = useState("");
  const [previousCompanyName, setPreviousCompanyName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: subPersonaData, isLoading: subPersonasLoading } = useActionQuery(
    "list-sub-personas",
    { personaId },
    { enabled: !!personaId },
  );
  const subPersonas: SubPersonaOption[] =
    (subPersonaData as { subPersonas?: SubPersonaOption[] })?.subPersonas ?? [];

  function handlePersonaChange(nextPersonaId: string) {
    setPersonaId(nextPersonaId);
    setSubPersonaId("");
  }

  function toggleSeniority(level: string) {
    setSelectedSeniorities((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }

  const canCreate = Boolean(name.trim() && personaId && intervalHours);

  async function handleCreate() {
    setError(null);
    if (!canCreate) return;
    try {
      await createSourcingRule.mutateAsync({
        name: name.trim(),
        personaId,
        subPersonaId: subPersonaId || undefined,
        icpId: icpId || undefined,
        companyAllowList: allowList.length ? allowList : undefined,
        companyDenyList: denyList.length ? denyList : undefined,
        manualTitleKeywords: titleKeywords.length ? titleKeywords : undefined,
        manualSeniorities: selectedSeniorities.size > 0 ? Array.from(selectedSeniorities) : undefined,
        minLinkedinFollowers: parseFollowerCount(minFollowersText),
        previousCompanyName: previousCompanyName.trim() || undefined,
        desiredVolume,
        intervalHours: intervalHours as number,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Couldn't create active list."));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <button type="button" onClick={onBack} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Back">
            <IconArrowLeft size={16} />
          </button>
          <h2 className="flex-1 text-sm font-semibold text-foreground">New active list</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted">
            <IconX size={16} />
          </button>
        </div>

        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto p-5">
          <p className="text-xs text-muted-foreground">
            Searches CommonRoom for people matching your persona at the companies you choose below, on a
            recurring schedule.
          </p>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Daily VP Eng outbound"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Persona</label>
            {personasLoading ? (
              <div className="flex h-9 items-center text-xs text-muted-foreground">
                <IconLoader2 size={13} className="mr-1.5 animate-spin" /> Loading personas…
              </div>
            ) : personas.length === 0 ? (
              <p className="text-xs text-muted-foreground/60">
                No personas yet — create one on the Personas page first.
              </p>
            ) : (
              <select
                value={personaId}
                onChange={(e) => handlePersonaChange(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="" disabled>
                  Select a persona…
                </option>
                {personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {personaId && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Sub-persona (optional)
              </label>
              {subPersonasLoading ? (
                <div className="flex h-9 items-center text-xs text-muted-foreground">
                  <IconLoader2 size={13} className="mr-1.5 animate-spin" /> Loading sub-personas…
                </div>
              ) : (
                <select
                  value={subPersonaId}
                  onChange={(e) => setSubPersonaId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">No sub-persona</option>
                  {subPersonas.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          <AdvancedProspectorFilters
            titleKeywords={titleKeywords}
            onTitleKeywordsChange={setTitleKeywords}
            selectedSeniorities={selectedSeniorities}
            onToggleSeniority={toggleSeniority}
            minFollowersText={minFollowersText}
            onMinFollowersChange={setMinFollowersText}
            previousCompanyName={previousCompanyName}
            onPreviousCompanyNameChange={setPreviousCompanyName}
          />

          <FormSectionHeader>Target companies</FormSectionHeader>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Company Criteria (optional)
            </label>
            {icpsLoading ? (
              <div className="flex h-9 items-center text-xs text-muted-foreground">
                <IconLoader2 size={13} className="mr-1.5 animate-spin" /> Loading Company Criteria…
              </div>
            ) : icps.length === 0 ? (
              <p className="text-xs text-muted-foreground/60">
                No Company Criteria yet — create one on the Company Criteria page.
              </p>
            ) : (
              <select
                value={icpId}
                onChange={(e) => setIcpId(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">No Company Criteria</option>
                {icps.map((icp) => (
                  <option key={icp.id} value={icp.id}>
                    {icp.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Companies (optional)
            </label>
            <CompanyTagInput
              values={allowList}
              onChange={setAllowList}
              placeholder="Search or type a company…"
              allowOwnerBrowse
            />
            <p className="mt-1 text-[11px] text-muted-foreground/60">
              Search your HubSpot companies, type a new one and press Enter, or browse by owner (AE or xDR) to
              add several at once.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Exclude companies (optional)
            </label>
            <CompanyTagInput values={denyList} onChange={setDenyList} placeholder="Search or type a company…" />
          </div>

          <FormSectionHeader>Volume &amp; schedule</FormSectionHeader>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Desired volume
            </label>
            <input
              type="number"
              min={1}
              max={200}
              value={desiredVolume}
              onChange={(e) => {
                const v = Number(e.target.value);
                setDesiredVolume(Number.isFinite(v) ? Math.min(200, Math.max(1, v)) : 1);
              }}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Run every
            </label>
            <select
              value={intervalHours}
              onChange={(e) => setIntervalHours(e.target.value ? Number(e.target.value) : "")}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="" disabled>
                Select a cadence…
              </option>
              {INTERVAL_HOURS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground/60">
              The pipeline runs on this recurring cadence to keep the list topped up.
            </p>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!canCreate || createSourcingRule.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            {createSourcingRule.isPending && <IconLoader2 size={12} className="animate-spin" />}
            Create active list
          </button>
        </div>
      </div>
    </div>
  );
}

function NewListPanel({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [type, setType] = useState<NewListType | null>(null);

  if (!type) {
    return <NewListTypeChoice onClose={onClose} onChoose={setType} />;
  }
  if (type === "static") {
    return <NewSegmentPanel onClose={onClose} onCreated={onCreated} onBack={() => setType(null)} />;
  }
  return <NewActiveListPanel onClose={onClose} onCreated={onCreated} onBack={() => setType(null)} />;
}

// ── Edit rule panel (relocated from sourcing-rules.tsx, unchanged) ──────────

function EditRulePanel({
  rule,
  onClose,
  onUpdated,
}: {
  rule: SourcingRule;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const updateSourcingRule = useActionMutation("update-sourcing-rule");

  const { data: icpData, isLoading: icpsLoading } = useActionQuery(
    "list-icps",
    {},
  );
  const icps: IcpOption[] =
    (icpData as { icps?: IcpOption[] })?.icps ?? [];

  const initialAllowList = safeParseList(rule.companyAllowList);
  const initialDenyList = safeParseList(rule.companyDenyList);
  const initialIcpId = rule.icpId ?? "";
  const initialTitleKeywords = safeParseList(rule.manualTitleKeywords);
  const initialSeniorities = safeParseList(rule.manualSeniorities);

  const [name, setName] = useState(rule.name);
  const [icpId, setIcpId] = useState(initialIcpId);
  const [allowList, setAllowList] = useState<string[]>(initialAllowList);
  const [denyList, setDenyList] = useState<string[]>(initialDenyList);
  const [desiredVolume, setDesiredVolume] = useState(rule.desiredVolume);
  // Rules created before this feature shipped have no intervalHours yet —
  // default the dropdown to a sensible starting value (4h) rather than
  // leaving it blank/invalid; the user must then explicitly pick and save a
  // real interval to persist one.
  const initialIntervalHours = rule.intervalHours ?? 4;
  const [intervalHours, setIntervalHours] = useState(initialIntervalHours);
  const [titleKeywords, setTitleKeywords] = useState<string[]>(initialTitleKeywords);
  const [selectedSeniorities, setSelectedSeniorities] = useState<Set<string>>(new Set(initialSeniorities));
  const [minFollowersText, setMinFollowersText] = useState(rule.minLinkedinFollowers?.toString() ?? "");
  const [previousCompanyName, setPreviousCompanyName] = useState(rule.previousCompanyName ?? "");
  const [error, setError] = useState<string | null>(null);

  function toggleSeniority(level: string) {
    setSelectedSeniorities((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }

  const nextAllowList = allowList;
  const nextDenyList = denyList;
  const nextTitleKeywords = titleKeywords;
  const nextSeniorities = Array.from(selectedSeniorities);
  const nextMinFollowers = parseFollowerCount(minFollowersText) ?? null;
  const nextPreviousCompanyName = previousCompanyName.trim() || null;

  const hasChanges =
    name.trim() !== rule.name ||
    icpId !== initialIcpId ||
    !sameList(nextAllowList, initialAllowList) ||
    !sameList(nextDenyList, initialDenyList) ||
    !sameList(nextTitleKeywords, initialTitleKeywords) ||
    !sameList(nextSeniorities, initialSeniorities) ||
    nextMinFollowers !== (rule.minLinkedinFollowers ?? null) ||
    nextPreviousCompanyName !== (rule.previousCompanyName ?? null) ||
    desiredVolume !== rule.desiredVolume ||
    intervalHours !== rule.intervalHours;

  const canSave = Boolean(name.trim() && intervalHours) && hasChanges;

  async function handleSave() {
    setError(null);
    if (!canSave) return;

    const payload = {
      id: rule.id,
      ...(name.trim() !== rule.name ? { name: name.trim() } : {}),
      ...(icpId !== initialIcpId ? { icpId: icpId || null } : {}),
      ...(!sameList(nextAllowList, initialAllowList) ? { companyAllowList: nextAllowList } : {}),
      ...(!sameList(nextDenyList, initialDenyList) ? { companyDenyList: nextDenyList } : {}),
      ...(!sameList(nextTitleKeywords, initialTitleKeywords) ? { manualTitleKeywords: nextTitleKeywords } : {}),
      ...(!sameList(nextSeniorities, initialSeniorities) ? { manualSeniorities: nextSeniorities } : {}),
      ...(nextMinFollowers !== (rule.minLinkedinFollowers ?? null) ? { minLinkedinFollowers: nextMinFollowers } : {}),
      ...(nextPreviousCompanyName !== (rule.previousCompanyName ?? null)
        ? { previousCompanyName: nextPreviousCompanyName }
        : {}),
      ...(desiredVolume !== rule.desiredVolume ? { desiredVolume } : {}),
      ...(intervalHours !== rule.intervalHours ? { intervalHours } : {}),
    };

    try {
      const result = await updateSourcingRule.mutateAsync(payload);
      if ((result as { ok?: boolean; error?: string })?.ok === false) {
        setError((result as { error: string }).error);
        return;
      }
      onUpdated();
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Couldn't update the automation settings."));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Edit automation settings</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted">
            <IconX size={16} />
          </button>
        </div>

        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto p-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <AdvancedProspectorFilters
            titleKeywords={titleKeywords}
            onTitleKeywordsChange={setTitleKeywords}
            selectedSeniorities={selectedSeniorities}
            onToggleSeniority={toggleSeniority}
            minFollowersText={minFollowersText}
            onMinFollowersChange={setMinFollowersText}
            previousCompanyName={previousCompanyName}
            onPreviousCompanyNameChange={setPreviousCompanyName}
          />

          <FormSectionHeader>Target companies</FormSectionHeader>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Company Criteria (optional)
            </label>
            {icpsLoading ? (
              <div className="flex h-9 items-center text-xs text-muted-foreground">
                <IconLoader2 size={13} className="mr-1.5 animate-spin" /> Loading Company Criteria…
              </div>
            ) : icps.length === 0 ? (
              <p className="text-xs text-muted-foreground/60">
                No Company Criteria yet — create one on the Company Criteria page.
              </p>
            ) : (
              <select
                value={icpId}
                onChange={(e) => setIcpId(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">No Company Criteria</option>
                {icps.map((icp) => (
                  <option key={icp.id} value={icp.id}>
                    {icp.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Companies (optional)
            </label>
            <CompanyTagInput
              values={allowList}
              onChange={setAllowList}
              placeholder="Search or type a company…"
              allowOwnerBrowse
            />
            <p className="mt-1 text-[11px] text-muted-foreground/60">
              Search your HubSpot companies, type a new one and press Enter, or browse by owner (AE or xDR) to
              add several at once.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Exclude companies (optional)
            </label>
            <CompanyTagInput values={denyList} onChange={setDenyList} placeholder="Search or type a company…" />
          </div>

          <FormSectionHeader>Volume &amp; schedule</FormSectionHeader>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Desired volume
            </label>
            <input
              type="number"
              min={1}
              max={200}
              value={desiredVolume}
              onChange={(e) => {
                const v = Number(e.target.value);
                setDesiredVolume(Number.isFinite(v) ? Math.min(200, Math.max(1, v)) : 1);
              }}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Run every
            </label>
            <select
              value={intervalHours}
              onChange={(e) => setIntervalHours(Number(e.target.value))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {INTERVAL_HOURS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave || updateSourcingRule.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            {updateSourcingRule.isPending && <IconLoader2 size={12} className="animate-spin" />}
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ── List detail view ─────────────────────────────────────────────────────────

function ListDetailView({
  id,
  isAdmin,
  onBack,
  onDeleted,
}: {
  id: string;
  isAdmin: boolean;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const { data, isLoading, error, refetch } = useActionQuery("get-segment", { id });
  const segment: SegmentDetail | undefined = (data as { segment?: SegmentDetail })?.segment;
  const contacts: SegmentContact[] = (data as { contacts?: SegmentContact[] })?.contacts ?? [];
  const loadError = !isLoading && !segment
    ? errorMessage(error, "Couldn't load this list.")
    : null;

  // When this list is Active, the owning sourcing rule's own fields (target,
  // schedule, filters, status) live in list-sourcing-rules rather than
  // get-segment — fetched only when needed, and cached/shared with any other
  // place on this page that queries the same action.
  const { data: rulesData, refetch: refetchRules } = useActionQuery(
    "list-sourcing-rules",
    {},
    { enabled: !!segment?.owningSourcingRuleId, refetchInterval: 30000, staleTime: 25000 },
  );
  const rules: SourcingRule[] = (rulesData as { rules?: SourcingRule[] })?.rules ?? [];
  const rule = segment?.owningSourcingRuleId
    ? rules.find((r) => r.id === segment.owningSourcingRuleId) ?? null
    : null;

  const { data: personaData } = useActionQuery(
    "list-personas",
    {},
    { enabled: !!segment?.owningSourcingRuleId },
  );
  const personaColorById = new Map(
    ((personaData as { personas?: PersonaOption[] })?.personas ?? []).map((p) => [p.id, p.color]),
  );

  const updateSegment = useActionMutation("update-segment");
  const assignSegment = useActionMutation("assign-segment");
  const refreshSegment = useActionMutation("refresh-segment");
  const deleteSegment = useActionMutation("delete-segment");
  const updateSourcingRule = useActionMutation("update-sourcing-rule");
  const deleteSourcingRule = useActionMutation("delete-sourcing-rule");

  const queryClient = useQueryClient();

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [assignDraft, setAssignDraft] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ruleActionError, setRuleActionError] = useState<string | null>(null);
  const [isRunningSourcingRule, setIsRunningSourcingRule] = useState(false);
  const [sourcingRunProgress, setSourcingRunProgress] = useState<SourcingRunProgress | null>(null);
  const [editingRule, setEditingRule] = useState(false);

  async function handleToggleVisibility() {
    if (!segment) return;
    setActionError(null);
    const next: Visibility = segment.visibility === "public" ? "private" : "public";
    try {
      await updateSegment.mutateAsync({ id, visibility: next });
      refetch();
    } catch (err) {
      setActionError(errorMessage(err, "Couldn't update visibility."));
    }
  }

  async function handleAssignBlur() {
    const value = (assignDraft ?? "").trim();
    setAssignDraft(null);
    if (!segment || !value || value === segment.assignedToEmail) return;
    setActionError(null);
    try {
      await assignSegment.mutateAsync({ id, assignedToEmail: value });
      refetch();
    } catch (err) {
      setActionError(errorMessage(err, "Couldn't assign list."));
    }
  }

  async function handleRefresh() {
    setActionError(null);
    try {
      await refreshSegment.mutateAsync({ id });
      refetch();
    } catch (err) {
      setActionError(errorMessage(err, "Couldn't refresh list."));
    }
  }

  async function handleRunSourcingRule() {
    if (!segment?.owningSourcingRuleId) return;
    setActionError(null);
    setIsRunningSourcingRule(true);
    setSourcingRunProgress(null);
    // The pipeline is now a resumable, chunked state machine (raising the
    // Active List volume cap to 1000 made a single synchronous request
    // impossible — scoring that many contacts would run well past any
    // realistic server function timeout even with the pipeline's own
    // concurrency). Each call below does ONE bounded unit of work (a few
    // more search pages, or a chunk of scoring) and returns `done: false`
    // with a `syncRecordId` to keep calling with until the run actually
    // finishes — this loop auto-continues while the tab stays open,
    // showing live progress each call, per Fred's explicit UX call. It does
    // NOT survive the tab closing mid-run; see the pipeline action's own
    // notes on the (unattempted) server-side safety-net stretch goal.
    let syncRecordId: string | undefined;
    try {
      for (;;) {
        const result = (await callAction(
          "run-sourcing-rule-pipeline",
          { ruleId: segment.owningSourcingRuleId, syncRecordId },
          { timeoutMs: 90_000 },
        )) as {
          done: boolean;
          syncRecordId: string;
          phase: "searching" | "scoring" | "complete";
          recordsFound: number;
          scored: number;
          remaining: number;
        };
        syncRecordId = result.syncRecordId;
        setSourcingRunProgress({
          phase: result.phase,
          recordsFound: result.recordsFound,
          scored: result.scored,
          remaining: result.remaining,
        });
        if (result.done) break;
      }
      refetch();
      refetchRules();
      // "Recent runs" has its own useActionQuery instance inside
      // RecentRunsSection (keyed on ruleId) — invalidate it directly rather
      // than waiting for its own 30s poll interval, so the just-completed
      // run shows up immediately.
      queryClient.invalidateQueries({ queryKey: ["action", "list-sourcing-rule-runs"] });
    } catch (err) {
      setActionError(errorMessage(err, "Couldn't find new prospects."));
    } finally {
      setIsRunningSourcingRule(false);
      setSourcingRunProgress(null);
    }
  }

  async function handleToggleRuleStatus() {
    if (!rule) return;
    setRuleActionError(null);
    const nextStatus: RuleStatus = rule.status === "active" ? "paused" : "active";
    try {
      const result = await updateSourcingRule.mutateAsync({ id: rule.id, status: nextStatus });
      if ((result as { ok?: boolean; error?: string })?.ok === false) {
        setRuleActionError((result as { error: string }).error);
        return;
      }
      refetchRules();
    } catch (err) {
      setRuleActionError(errorMessage(err, "Couldn't update the rule's status."));
    }
  }

  // Deleting an Active list is two independent mutations with no shared
  // transaction between them — delete-sourcing-rule (stop automation + drop
  // the job resource) then delete-segment (drop the segment/contacts). If
  // the first succeeds but the second then fails (network blip, a future
  // writability check, etc.), the rule is already gone but the segment
  // survives. ruleDeletedRef records that so a retry skips straight to
  // deleteSegment instead of re-attempting a delete against a now-nonexistent
  // rule id — which would otherwise soft-fail with a confusing "not found"
  // error and never reach the segment delete at all. (Without this ref,
  // navigating away and back would eventually self-heal too, since a
  // fresh get-segment fetch reports owningSourcingRuleId: null once the rule
  // is gone — but that recovery path is invisible to the user in the
  // moment, so we make the retry work correctly immediately instead.)
  const ruleDeletedRef = useRef(false);

  async function handleDelete() {
    setActionError(null);

    if (segment?.owningSourcingRuleId && !ruleDeletedRef.current) {
      try {
        const ruleResult = await deleteSourcingRule.mutateAsync({ id: segment.owningSourcingRuleId });
        if ((ruleResult as { ok?: boolean; error?: string })?.ok === false) {
          setActionError((ruleResult as { error: string }).error);
          setConfirmDelete(false);
          return;
        }
        ruleDeletedRef.current = true;
      } catch (err) {
        setActionError(errorMessage(err, "Couldn't stop this list's automation."));
        setConfirmDelete(false);
        return;
      }
    }

    try {
      await deleteSegment.mutateAsync({ id });
      onDeleted();
    } catch (err) {
      setActionError(
        ruleDeletedRef.current
          ? "Automation removed, but couldn't delete the list — click delete again to finish."
          : errorMessage(err, "Couldn't delete list."),
      );
      setConfirmDelete(false);
    }
  }

  const isDeleting = deleteSegment.isPending || deleteSourcingRule.isPending;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Back to lists"
        >
          <IconArrowLeft size={16} />
        </button>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !segment ? (
          <p className="text-sm text-destructive">{loadError}</p>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-sm font-semibold text-foreground">{segment.name}</h1>
                <ListTypeBadge isActive={!!segment.owningSourcingRuleId} />
                <VisibilityBadge visibility={segment.visibility} />
              </div>
              <p className="text-xs text-muted-foreground">
                {contacts.length.toLocaleString()} contact{contacts.length === 1 ? "" : "s"} · {formatRelativeTime(segment.lastRefreshedAt)}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={handleToggleVisibility}
                disabled={updateSegment.isPending}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
              >
                Make {segment.visibility === "public" ? "private" : "public"}
              </button>

              {segment.owningSourcingRuleId ? (
                <button
                  type="button"
                  onClick={handleRunSourcingRule}
                  disabled={isRunningSourcingRule}
                  title="Find fresh prospects for this list right now, instead of waiting for the next scheduled run"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                >
                  {isRunningSourcingRule ? (
                    <IconLoader2 size={12} className="animate-spin" />
                  ) : (
                    <IconRefresh size={12} />
                  )}
                  {isRunningSourcingRule ? buildSourcingRunLabel(sourcingRunProgress) : "Find prospects now"}
                </button>
              ) : (
                segment.personaId && (
                  <button
                    type="button"
                    onClick={handleRefresh}
                    disabled={refreshSegment.isPending}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                  >
                    {refreshSegment.isPending ? (
                      <IconLoader2 size={12} className="animate-spin" />
                    ) : (
                      <IconRefresh size={12} />
                    )}
                    Refresh
                  </button>
                )
              )}

              {confirmDelete ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={isDeleting}
                    className="rounded-md px-2.5 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
                  >
                    {isDeleting ? "Deleting…" : "Confirm delete"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted"
                  >
                    <IconX size={13} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-destructive"
                  aria-label="Delete list"
                >
                  <IconTrash size={15} />
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {!isLoading && segment && segment.owningSourcingRuleId && (
        <div className="border-b border-border px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Automation
            </h2>
            {rule && (
              <div className="flex items-center gap-1.5">
                <StatusBadge status={rule.status} />
                <button
                  type="button"
                  onClick={handleToggleRuleStatus}
                  disabled={updateSourcingRule.isPending}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                  aria-label={rule.status === "active" ? "Pause rule" : "Resume rule"}
                  title={rule.status === "active" ? "Pause rule" : "Resume rule"}
                >
                  {rule.status === "active" ? <IconPlayerPause size={14} /> : <IconPlayerPlay size={14} />}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingRule(true)}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Edit automation settings"
                  title="Edit automation settings"
                >
                  <IconPencil size={14} />
                </button>
              </div>
            )}
          </div>

          {ruleActionError && <p className="mb-2 text-xs text-destructive">{ruleActionError}</p>}

          {!rule ? (
            <p className="text-xs text-muted-foreground/60">Loading automation settings…</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {rule.personaName && (
                  <PersonaBadge name={rule.personaName} color={personaColorById.get(rule.personaId) ?? null} />
                )}
                {rule.subPersonaName && <span>› {rule.subPersonaName}</span>}
                {rule.icpName && <span className="text-muted-foreground/70">ICP: {rule.icpName}</span>}
                <span className="inline-flex items-center gap-1">
                  <IconUsers size={12} /> {rule.desiredVolume} desired
                </span>
                {rule.intervalHours != null ? (
                  <span className="inline-flex items-center gap-1">
                    <IconClock size={12} /> Runs every {rule.intervalHours} hour{rule.intervalHours === 1 ? "" : "s"}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <IconClock size={12} /> Ready by {rule.readyByTime} · {rule.leadHours}h lead
                  </span>
                )}
              </div>
              {(safeParseList(rule.companyAllowList).length > 0 ||
                safeParseList(rule.companyDenyList).length > 0 ||
                safeParseList(rule.manualTitleKeywords).length > 0 ||
                safeParseList(rule.manualSeniorities).length > 0 ||
                rule.minLinkedinFollowers != null ||
                rule.previousCompanyName) && (
                <div className="mt-1.5 flex flex-col gap-0.5 text-[11px] text-muted-foreground/70">
                  {safeParseList(rule.companyAllowList).length > 0 && (
                    <p>Allow: {safeParseList(rule.companyAllowList).join(", ")}</p>
                  )}
                  {safeParseList(rule.companyDenyList).length > 0 && (
                    <p>Deny: {safeParseList(rule.companyDenyList).join(", ")}</p>
                  )}
                  {safeParseList(rule.manualTitleKeywords).length > 0 && (
                    <p>Titles: {safeParseList(rule.manualTitleKeywords).join(", ")}</p>
                  )}
                  {safeParseList(rule.manualSeniorities).length > 0 && (
                    <p>Seniority: {safeParseList(rule.manualSeniorities).join(", ")}</p>
                  )}
                  {rule.minLinkedinFollowers != null && <p>Min. followers: {rule.minLinkedinFollowers}</p>}
                  {rule.previousCompanyName && <p>Previously at: {rule.previousCompanyName}</p>}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {!isLoading && segment && segment.owningSourcingRuleId && (
        <RecentRunsSection ruleId={segment.owningSourcingRuleId} />
      )}

      {!isLoading && segment && (isAdmin || segment.assignedToEmail) && (
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="text-xs font-medium text-muted-foreground">Assigned to</span>
          {isAdmin ? (
            <>
              <input
                value={assignDraft ?? segment.assignedToEmail ?? ""}
                onChange={(e) => setAssignDraft(e.target.value)}
                onBlur={handleAssignBlur}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                placeholder="email@company.com"
                className="w-64 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {assignSegment.isPending && <IconLoader2 size={12} className="animate-spin text-muted-foreground" />}
            </>
          ) : (
            <span className="text-xs text-foreground">{segment.assignedToEmail}</span>
          )}
        </div>
      )}

      {actionError && (
        <p className="border-b border-border bg-destructive/5 px-4 py-2 text-xs text-destructive">
          {actionError}
        </p>
      )}

      {isLoading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <IconLoader2 size={20} className="animate-spin text-muted-foreground" />
        </div>
      ) : loadError ? null : segment ? (
        // Sourced from list-contacts (scoped via segmentId), NOT from
        // get-segment's own embedded `contacts` array above — that array
        // now only backs this header's contact count/relative-refresh text.
        // showPersonaFilter=false: a single list is usually already
        // persona-scoped by construction (built from one persona, or by a
        // sourcing rule targeting one), so a second persona filter here
        // would mostly just narrow an already-narrow set.
        <ContactsTable segmentId={id} showPersonaFilter={false} />
      ) : null}

      {editingRule && rule && (
        <EditRulePanel
          rule={rule}
          onClose={() => setEditingRule(false)}
          onUpdated={() => refetchRules()}
        />
      )}
    </div>
  );
}

// ── Route ────────────────────────────────────────────────────────────────────

export default function ListsRoute() {
  const { data: roleData } = useActionQuery("get-my-role", {});
  const isAdmin = (roleData as { role?: string })?.role === "admin";

  const { data, isLoading, refetch } = useActionQuery("list-segments", {}, {
    refetchInterval: 30000,
    staleTime: 25000,
  });
  const lists: SegmentListRow[] = (data as { segments?: SegmentListRow[] })?.segments ?? [];

  const [creating, setCreating] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);

  if (viewingId) {
    return (
      <ListDetailView
        id={viewingId}
        isAdmin={isAdmin}
        onBack={() => {
          setViewingId(null);
          refetch();
        }}
        onDeleted={() => {
          setViewingId(null);
          refetch();
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold text-foreground">Lists</h1>
          <p className="text-xs text-muted-foreground">
            {isLoading
              ? "Loading…"
              : lists.length === 0
                ? "No lists yet — create a static list from a persona, or an active list on a schedule"
                : `${lists.length} list${lists.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <IconPlus size={13} />
          New list
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <IconLoader2 size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : lists.length === 0 ? (
          <div
            className="flex h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border text-center transition-colors hover:border-border/60 hover:bg-muted/20"
            onClick={() => setCreating(true)}
          >
            <IconListDetails size={32} className="text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">No lists yet</p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                Create a static list from a persona, or an active list to auto-populate on a schedule
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {lists.map((s) => (
              <ListCard key={s.id} list={s} onOpen={() => setViewingId(s.id)} />
            ))}
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border text-muted-foreground/50 transition-colors hover:border-border hover:text-muted-foreground"
            >
              <IconPlus size={22} />
              <span className="text-xs font-medium">New list</span>
            </button>
          </div>
        )}
      </div>

      {creating && (
        <NewListPanel onClose={() => setCreating(false)} onCreated={refetch} />
      )}
    </div>
  );
}
