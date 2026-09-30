import { TEAM_LABELS, type PlaybookRole } from "@shared/playbook-roles";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Panel({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card shadow-xs">
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-2">
        <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
        {aside}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

const chip =
  "inline-flex h-[22px] items-center rounded-[5px] border px-1.5 text-[11.5px] font-medium";

export function TeamChip({ team }: { team: string }) {
  const label =
    team === "both"
      ? "PA team and RevOps"
      : (TEAM_LABELS[team as PlaybookRole] ?? team);
  return (
    <span className={cn(chip, "border-border text-muted-foreground")}>
      {label}
    </span>
  );
}

const ENFORCEMENT: Record<
  string,
  { label: string; className: string; title: string }
> = {
  enforced: {
    label: "Enforced",
    className: "border-border text-foreground",
    title: "Code evaluates this rule",
  },
  guidance: {
    label: "Guidance",
    className: "border-border text-muted-foreground",
    title: "The agent reads this; code does not evaluate it",
  },
  not_enforced: {
    label: "Not enforced yet",
    className:
      "border-dashed border-amber-500/60 text-amber-700 dark:text-amber-400",
    title:
      "Published, but code has no evaluator for it yet. The app owner has a build suggestion.",
  },
  retired: {
    label: "Retired",
    className: "border-border text-muted-foreground line-through",
    title: "No longer in effect",
  },
};

export function EnforcementChip({ enforcement }: { enforcement: string }) {
  const view = ENFORCEMENT[enforcement] ?? ENFORCEMENT.guidance;
  return (
    <span className={cn(chip, view.className)} title={view.title}>
      {view.label}
    </span>
  );
}

export function PendingChip({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span
      className={cn(chip, "border-dashed border-border text-muted-foreground")}
      title="Values that wait for their owner's confirmation"
    >
      {count} to confirm
    </span>
  );
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  in_review: "In review",
  published: "Published",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export function ChangeStatus({ status }: { status: string }) {
  return (
    <span
      className={cn(
        chip,
        status === "published"
          ? "border-transparent bg-ink text-ink-foreground"
          : status === "in_review"
            ? "border-foreground/30 text-foreground"
            : "border-border text-muted-foreground",
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/40 p-2.5 text-[12px] leading-relaxed text-foreground">
      {value === null || value === undefined
        ? "none"
        : JSON.stringify(value, null, 2)}
    </pre>
  );
}

const FIELD_LABELS: Record<string, string> = {
  body: "Text",
  rationale: "Why",
  position: "Position",
  section: "Section",
  status: "Status",
  owner_team: "Owning team",
  owner: "Owner",
};

function show(value: unknown, label?: (code: string) => string): string {
  if (value === undefined || value === null || value === "") return "none";
  if (typeof value === "string") return label ? label(value) : value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}

/**
 * Readable change lines for one item: list additions and removals, scalar
 * before and after, and whole-value replacement only as a last resort.
 */
export function describeItem(
  item: { op: string; beforeValue: unknown; afterValue: unknown },
  label?: (code: string) => string,
): string[] {
  if (item.op === "retire") return ["Removed from the playbook"];
  const before = (item.beforeValue ?? {}) as Record<string, unknown>;
  const after = (item.afterValue ?? {}) as Record<string, unknown>;
  const lines: string[] = [];
  if (item.op === "add") lines.push("New block");
  const beforeParams = (
    item.op === "set_config" ? before : (before.params ?? {})
  ) as Record<string, unknown>;
  const afterParams = (
    item.op === "set_config" ? after : (after.params ?? {})
  ) as Record<string, unknown>;
  for (const key of new Set([
    ...Object.keys(beforeParams),
    ...Object.keys(afterParams),
  ])) {
    const was = beforeParams[key];
    const now = afterParams[key];
    if (JSON.stringify(was) === JSON.stringify(now)) continue;
    const name = key.replace(/_/g, " ");
    if (Array.isArray(was) || Array.isArray(now)) {
      const a = (Array.isArray(was) ? was : []).map((value) =>
        show(value, label),
      );
      const b = (Array.isArray(now) ? now : []).map((value) =>
        show(value, label),
      );
      const added = b.filter((value) => !a.includes(value));
      const removed = a.filter((value) => !b.includes(value));
      if (added.length) lines.push(`${name}: added ${added.join(", ")}`);
      if (removed.length) lines.push(`${name}: removed ${removed.join(", ")}`);
      if (!added.length && !removed.length)
        lines.push(`${name}: reordered to ${b.join(", ")}`);
    } else {
      lines.push(`${name}: ${show(was, label)} to ${show(now, label)}`);
    }
  }
  if (item.op !== "set_config") {
    for (const key of Object.keys(FIELD_LABELS)) {
      if (
        JSON.stringify(before[key]) !== JSON.stringify(after[key]) &&
        !(item.op === "add" && key === "position")
      ) {
        lines.push(
          `${FIELD_LABELS[key]}: ${show(before[key])} to ${show(after[key])}`,
        );
      }
    }
  }
  return lines.length ? lines : ["No visible change"];
}
