import type { CitationView, OwnerView } from "@shared/pa-views";
import { IconShieldExclamation } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

const TERMINAL_STATES = new Set(["closed", "disqualified", "recycled"]);
const PROGRESS_STATES = new Set([
  "first_touch_sent",
  "replied",
  "meeting_booked",
  "ql",
  "sal",
]);

export function StateBadge({
  state,
  label,
  className,
}: {
  state: string;
  label: string;
  className?: string;
}) {
  const terminal = TERMINAL_STATES.has(state);
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-[5px] border px-2 text-[12px] font-medium leading-none",
        terminal
          ? "border-border bg-transparent text-muted-foreground"
          : "border-border bg-card text-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          terminal
            ? "border border-muted-foreground/60"
            : PROGRESS_STATES.has(state)
              ? "bg-foreground"
              : "bg-foreground/55",
        )}
      />
      {label}
    </span>
  );
}

export function VerdictText({ label }: { label: string }) {
  return (
    <span className="text-[12px] text-muted-foreground">
      Suggests <span className="font-medium text-foreground">{label}</span>
    </span>
  );
}

export function FlagBadge({
  children = "Flagged for review",
}: {
  children?: ReactNode;
}) {
  return (
    <span className="inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-[5px] bg-ink px-1.5 text-[11.5px] font-medium leading-none text-ink-foreground">
      <IconShieldExclamation
        className="size-3.5"
        strokeWidth={2}
        aria-hidden="true"
      />
      {children}
    </span>
  );
}

export function ShadowPill({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full border border-dashed border-foreground/30 px-2 text-[11.5px] font-medium leading-none text-foreground",
        className,
      )}
      title="Shadow mode: PA Hub decides and records, but sends nothing and writes nothing to the CRM"
    >
      <span aria-hidden="true" className="relative flex size-2">
        <span className="absolute inset-0 rounded-full border border-foreground/60" />
        <span className="absolute inset-y-0 left-0 w-1 rounded-l-full bg-foreground/60" />
      </span>
      Shadow mode
    </span>
  );
}

export function ReleaseChip({
  shortId,
  label = "rel",
  className,
}: {
  shortId: string;
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-[5px] border border-border bg-card px-1.5 font-mono text-[11px] leading-none text-muted-foreground",
        className,
      )}
      title={`Playbook release ${shortId}`}
    >
      <span>{label}</span>
      <span className="text-foreground">{shortId}</span>
    </span>
  );
}

export function CitationChips({
  entries,
  className,
}: {
  entries: CitationView[];
  className?: string;
}) {
  if (entries.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {entries.map((entry) => (
        <span
          key={`${entry.id}:${entry.version}`}
          className={cn(
            "inline-flex h-5 items-center whitespace-nowrap rounded-[4px] border px-1.5 font-mono text-[10.5px] leading-none",
            entry.unconfirmed
              ? "border-dashed border-foreground/35 text-muted-foreground"
              : "border-border bg-muted/60 text-muted-foreground",
          )}
          title={
            entry.unconfirmed
              ? "Value awaits owner confirmation"
              : "Playbook entry and version"
          }
        >
          {entry.id}
          <span className="ml-1 text-foreground/70">v{entry.version}</span>
        </span>
      ))}
    </div>
  );
}

export function OwnerChip({
  owner,
  source,
  compact,
}: {
  owner: OwnerView | null;
  source?: string | null;
  compact?: boolean;
}) {
  if (!owner) {
    return (
      <span className="text-[13px] text-muted-foreground">Unassigned</span>
    );
  }
  return (
    <span
      className="inline-flex min-w-0 items-center gap-2"
      title={source ? `${owner.email} (${source})` : owner.email}
    >
      <span
        aria-hidden="true"
        className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-secondary-foreground ring-1 ring-border"
      >
        {initials(owner.name, owner.email)}
      </span>
      <span className="min-w-0 truncate text-[13px] text-foreground">
        {owner.name}
      </span>
      {owner.isMe && !compact ? (
        <span className="shrink-0 rounded-[4px] bg-secondary px-1 text-[10.5px] font-medium text-muted-foreground">
          You
        </span>
      ) : null}
    </span>
  );
}
