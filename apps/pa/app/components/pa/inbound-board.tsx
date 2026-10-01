import type { BoardResult, BoardRow, BoardTab } from "@shared/pa-views";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconArrowsSort,
  IconCheck,
  IconExternalLink,
  IconFilter,
  IconMessageCircleQuestion,
  IconShieldExclamation,
  IconX,
} from "@tabler/icons-react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { Link, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BOARD_SORTS,
  BOARD_WINDOWS,
  isNewLead,
  NEW_LEAD_MINUTES,
  type BoardSort,
  type BoardWindow,
} from "@/lib/board-arrange";
import { countryName, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

import { OwnerChip } from "./badges";
import { SlaCell } from "./clock";
import { DecisionPill, DraftPreview, TriageBadge } from "./triage";

export const BOARD_TABS: Array<{ id: BoardTab; label: string }> = [
  { id: "mine", label: "Mine" },
  { id: "team", label: "Team" },
  { id: "decide", label: "Needs decision" },
  { id: "at_risk", label: "At risk" },
  { id: "breached", label: "Breached" },
];

function tabHref(tab: BoardTab, state: string | undefined) {
  const params = new URLSearchParams({ tab });
  if (state) params.set("state", state);
  return `?${params.toString()}`;
}

/** Who takes the meeting (D66), under the class on each row. */
function RouteLine({ row }: { row: BoardRow }) {
  const route = row.leadRoute;
  if (!route || route.route === "no_sales_email") return null;
  const who = route.meetingWith;
  return (
    <p className="mt-1.5 flex items-center gap-1 text-[12.5px] font-medium text-foreground">
      <IconArrowRight
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="truncate">
        {route.label}
        {who ? `, ${who.name ?? who.email}` : ""}
      </span>
      {route.gaps.length > 0 ? (
        <IconAlertTriangle
          className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
          aria-label={route.gaps.join(" ")}
        />
      ) : null}
    </p>
  );
}

export function BoardTabs({
  tab,
  state,
  counts,
}: {
  tab: BoardTab;
  state?: string;
  counts: Record<BoardTab, number> | null;
}) {
  return (
    <nav
      aria-label="Board filters"
      className="inline-flex rounded-lg border border-border bg-muted/60 p-0.5"
    >
      {BOARD_TABS.map((item) => {
        const active = item.id === tab;
        const count = counts?.[item.id] ?? null;
        const alert =
          count !== null &&
          count > 0 &&
          (item.id === "at_risk" || item.id === "breached");
        return (
          <Link
            key={item.id}
            to={tabHref(item.id, state)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-3",
              active
                ? "bg-card text-foreground shadow-xs ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
            {count !== null ? (
              <span
                className={cn(
                  "min-w-5 rounded-[5px] px-1 text-center text-[11.5px] tabular-nums",
                  alert
                    ? item.id === "breached"
                      ? "bg-destructive-soft text-destructive-strong"
                      : "bg-warning-soft text-warning-foreground"
                    : "text-muted-foreground",
                )}
              >
                {count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** Sort and time window for the board (newest first by default). */
export function ViewControls({
  sort,
  within,
  onSort,
  onWithin,
}: {
  sort: BoardSort;
  within: BoardWindow;
  onSort: (sort: BoardSort) => void;
  onWithin: (within: BoardWindow) => void;
}) {
  const sortLabel = BOARD_SORTS.find((item) => item.id === sort)?.label;
  const windowLabel = BOARD_WINDOWS.find((item) => item.id === within)?.label;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 text-[13px]"
        >
          <IconArrowsSort
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
          {sortLabel}
          {within !== "all" ? (
            <span className="text-muted-foreground">, {windowLabel}</span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-[12px] text-muted-foreground">
          Sort
        </DropdownMenuLabel>
        {BOARD_SORTS.map((item) => (
          <DropdownMenuItem
            key={item.id}
            onSelect={() => onSort(item.id)}
            className="text-[13px]"
          >
            <IconCheck
              className={cn(
                "size-4",
                item.id === sort ? "opacity-100" : "opacity-0",
              )}
              aria-hidden="true"
            />
            {item.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[12px] text-muted-foreground">
          Submitted
        </DropdownMenuLabel>
        {BOARD_WINDOWS.map((item) => (
          <DropdownMenuItem
            key={item.id}
            onSelect={() => onWithin(item.id)}
            className="text-[13px]"
          >
            <IconCheck
              className={cn(
                "size-4",
                item.id === within ? "opacity-100" : "opacity-0",
              )}
              aria-hidden="true"
            />
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function StateFilter({
  states,
  value,
  onChange,
}: {
  states: BoardResult["states"];
  value: string | undefined;
  onChange: (state: string | undefined) => void;
}) {
  const current = states.find((item) => item.state === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 text-[13px]"
        >
          <IconFilter
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
          {value ? (current?.label ?? "State") : "All states"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-[12px] text-muted-foreground">
          Filter by state
        </DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={() => onChange(undefined)}
          className="text-[13px]"
        >
          <IconCheck
            className={cn("size-4", value ? "opacity-0" : "opacity-100")}
            aria-hidden="true"
          />
          All states
        </DropdownMenuItem>
        {states.length > 0 ? <DropdownMenuSeparator /> : null}
        {states.map((item) => (
          <DropdownMenuItem
            key={item.state}
            onSelect={() => onChange(item.state)}
            className="text-[13px]"
          >
            <IconCheck
              className={cn(
                "size-4",
                value === item.state ? "opacity-100" : "opacity-0",
              )}
              aria-hidden="true"
            />
            <span className="flex-1">{item.label}</span>
            <span className="text-[12px] tabular-nums text-muted-foreground">
              {item.count}
            </span>
          </DropdownMenuItem>
        ))}
        {value && !current ? (
          <DropdownMenuItem
            onSelect={() => onChange(value)}
            className="text-[13px]"
          >
            <IconCheck className="size-4" aria-hidden="true" />
            <span className="flex-1">{value.replace(/_/g, " ")}</span>
            <span className="text-[12px] tabular-nums text-muted-foreground">
              0
            </span>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ReviewMark() {
  return (
    <span
      className="inline-flex h-[18px] shrink-0 items-center gap-0.5 rounded-[4px] bg-ink px-1 text-[10.5px] font-medium text-ink-foreground"
      title="Flagged for review: the message contains instruction-like text. Nothing in it was followed."
    >
      <IconShieldExclamation
        className="size-3"
        strokeWidth={2}
        aria-hidden="true"
      />
      Review
    </span>
  );
}

function leadSubline(row: BoardRow) {
  const place = countryName(row.lead.country);
  return [row.lead.company ?? row.lead.domain, place]
    .filter(Boolean)
    .join(" · ");
}

function recordHref(id: string, tab: BoardTab, query?: string) {
  return `/inbound/${id}?${query ?? `tab=${tab}`}`;
}

/** Marks a request that just came in, so it is easy to spot at the top. */
function NewMark({ row, now }: { row: BoardRow; now: number }) {
  if (!isNewLead(row, now)) return null;
  return (
    <span
      className="shrink-0 rounded-[4px] bg-sky-500/12 px-1.5 py-px text-[11px] font-medium text-sky-700 dark:text-sky-300"
      title={`Submitted in the last ${NEW_LEAD_MINUTES} minutes`}
    >
      New
    </span>
  );
}

function stopRowClick(event: MouseEvent | KeyboardEvent) {
  event.stopPropagation();
}

function HeaderCell({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "sticky top-0 z-10 border-b border-border bg-card px-2.5 py-2.5 font-medium",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function BoardTable({
  rows,
  now,
  tab,
  linkQuery,
  selected,
  onToggle,
  onToggleAll,
}: {
  rows: BoardRow[];
  now: number;
  tab: BoardTab;
  linkQuery?: string;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
}) {
  const navigate = useNavigate();
  const allSelected =
    rows.length > 0 && rows.every((row) => selected.has(row.id));
  const someSelected = !allSelected && rows.some((row) => selected.has(row.id));
  return (
    <table className="w-full table-fixed border-separate border-spacing-0 text-left">
      <colgroup>
        <col className="w-11" />
        <col className="w-[20%]" />
        <col className="w-[27%]" />
        <col />
        <col className="w-[15%]" />
      </colgroup>
      <thead>
        <tr className="text-[11.5px] font-medium text-muted-foreground">
          <HeaderCell className="px-3.5">
            <Checkbox
              checked={
                allSelected ? true : someSelected ? "indeterminate" : false
              }
              onCheckedChange={(checked) => onToggleAll(checked === true)}
              aria-label="Select all visible leads"
              className="pa-check"
            />
          </HeaderCell>
          <HeaderCell>Lead</HeaderCell>
          <HeaderCell>Classified as</HeaderCell>
          <HeaderCell>Drafted reply</HeaderCell>
          <HeaderCell className="pr-4">Owner and SLA</HeaderCell>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const isSelected = selected.has(row.id);
          const href = recordHref(row.id, tab, linkQuery);
          return (
            <tr
              key={row.id}
              onClick={() => navigate(href)}
              data-selected={isSelected ? "true" : undefined}
              className={cn(
                "group cursor-pointer align-top transition-colors hover:bg-accent/45",
                isSelected && "bg-accent/60 hover:bg-accent/70",
              )}
            >
              <td
                className="border-b border-border px-3.5 py-3"
                onClick={stopRowClick}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => onToggle(row.id)}
                  aria-label={`Select ${row.lead.name ?? row.lead.email}`}
                  className="pa-check mt-0.5"
                />
              </td>
              <td className="border-b border-border px-2.5 py-3">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Link
                    to={href}
                    onClick={stopRowClick}
                    className="min-w-0 truncate rounded-[3px] text-[13.5px] font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {row.lead.name ?? row.lead.email}
                  </Link>
                  <NewMark row={row} now={now} />
                  {row.flagged ? <ReviewMark /> : null}
                </div>
                <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                  {leadSubline(row)}
                </p>
                <p className="mt-0.5 flex items-center gap-2 text-[11.5px] tabular-nums text-muted-foreground">
                  {formatRelative(row.submittedAt, now)}
                  {row.lead.crmUrl ? (
                    <a
                      href={row.lead.crmUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={stopRowClick}
                      className="inline-flex items-center gap-0.5 rounded-[3px] text-foreground/80 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      HubSpot
                      <IconExternalLink className="size-3" aria-hidden="true" />
                    </a>
                  ) : null}
                </p>
              </td>
              <td className="border-b border-border px-2.5 py-3">
                <TriageBadge triage={row.triage} />
                <RouteLine row={row} />
                <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-[1.45] text-muted-foreground">
                  {row.triage.why}
                </p>
              </td>
              <td className="border-b border-border px-2.5 py-3">
                <DraftPreview draft={row.draft} />
              </td>
              <td className="border-b border-border px-2.5 py-3 pr-4">
                <OwnerChip owner={row.owner} compact />
                <div className="mt-1.5">
                  <SlaCell sla={row.sla} />
                </div>
                <div className="mt-1">
                  <DecisionPill decision={row.decision} />
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function BoardCards({
  rows,
  tab,
  linkQuery,
  now = Date.now(),
  selected,
  onToggle,
}: {
  rows: BoardRow[];
  tab: BoardTab;
  linkQuery?: string;
  now?: number;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((row) => {
        const isSelected = selected.has(row.id);
        return (
          <li
            key={row.id}
            className={cn(
              "relative flex gap-3 px-4 py-3.5",
              isSelected && "bg-accent/60",
            )}
          >
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggle(row.id)}
              aria-label={`Select ${row.lead.name ?? row.lead.email}`}
              className="pa-check relative z-10 mt-1"
            />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Link
                    to={recordHref(row.id, tab, linkQuery)}
                    className="min-w-0 truncate text-[14px] font-medium text-foreground after:absolute after:inset-0 focus-visible:outline-none"
                  >
                    {row.lead.name ?? row.lead.email}
                  </Link>
                  <NewMark row={row} now={now} />
                  {row.flagged ? <ReviewMark /> : null}
                </div>
                <p className="truncate text-[12px] text-muted-foreground">
                  {leadSubline(row)}
                </p>
              </div>
              <div>
                <TriageBadge triage={row.triage} />
                <RouteLine row={row} />
                <p className="mt-0.5 text-[12.5px] leading-[1.45] text-muted-foreground">
                  {row.triage.why}
                </p>
              </div>
              <div className="rounded-md border border-border px-2.5 py-2">
                <DraftPreview draft={row.draft} />
              </div>
              <div className="flex items-end justify-between gap-4">
                <OwnerChip owner={row.owner} compact />
                <div className="w-40">
                  <SlaCell sla={row.sla} />
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function SelectionBar({
  count,
  onAsk,
  onClear,
}: {
  count: number;
  onAsk: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/50 px-4 py-2">
      <span className="text-[13px] font-medium text-foreground">
        {count} selected
      </span>
      <div className="ml-auto flex items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="h-8 text-[13px]"
        >
          <IconX className="size-4" aria-hidden="true" />
          Clear
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onAsk}
          className="h-8 text-[13px]"
        >
          <IconMessageCircleQuestion className="size-4" aria-hidden="true" />
          Ask agent about these
        </Button>
      </div>
    </div>
  );
}

export function BoardSkeleton() {
  return (
    <div
      className="divide-y divide-border"
      aria-busy="true"
      aria-label="Loading leads"
    >
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="flex items-center gap-4 px-4 py-4">
          <div className="size-4 rounded-sm bg-muted" />
          <div className="w-40 space-y-1.5">
            <div className="h-3.5 w-28 animate-pulse rounded bg-muted" />
            <div className="h-3 w-36 animate-pulse rounded bg-muted/70" />
          </div>
          <div className="hidden flex-1 space-y-1.5 sm:block">
            <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
            <div className="h-3 w-3/5 animate-pulse rounded bg-muted/70" />
          </div>
          <div className="h-5 w-28 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
