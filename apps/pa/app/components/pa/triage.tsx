// The two things a PA reads first on every lead (D49): how it was classified,
// and the drafted reply. Everything else on the record sits behind "Details".
import type {
  DraftStatus,
  DraftSummary,
  DraftView,
  TriageKind,
  TriageView,
} from "@shared/pa-views";
import {
  IconAlertTriangle,
  IconCalendar,
  IconCheck,
  IconCopy,
  IconMessageCircleQuestion,
  IconPencil,
} from "@tabler/icons-react";
import { Fragment, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { CitationChips } from "./badges";

const KIND_STYLES: Record<TriageKind, string> = {
  reply: "bg-primary-soft text-primary ring-primary/25",
  review: "bg-warning-soft text-warning-foreground ring-warning/40",
  owner: "bg-secondary text-foreground ring-border",
  elsewhere: "bg-transparent text-muted-foreground ring-border",
  closed: "bg-transparent text-muted-foreground ring-border",
  pending: "bg-muted text-muted-foreground ring-border",
};

const KIND_DOTS: Record<TriageKind, string> = {
  reply: "bg-primary",
  review: "bg-warning",
  owner: "bg-foreground/60",
  elsewhere: "border border-muted-foreground/60",
  closed: "border border-muted-foreground/60",
  pending: "bg-muted-foreground/50",
};

export function TriageBadge({
  triage,
  className,
}: {
  triage: TriageView;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] max-w-full items-center gap-1.5 whitespace-nowrap rounded-[5px] px-2 text-[12px] font-medium leading-none ring-1 ring-inset",
        KIND_STYLES[triage.kind],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 shrink-0 rounded-full", KIND_DOTS[triage.kind])}
      />
      <span className="truncate">{triage.label}</span>
    </span>
  );
}

const DRAFT_STATUS: Record<
  DraftStatus,
  { label: string; className: string; icon: typeof IconCheck | null }
> = {
  ready: {
    label: "Ready to review",
    className: "bg-primary-soft text-primary",
    icon: IconCheck,
  },
  needs_edit: {
    label: "Needs edits",
    className: "bg-warning-soft text-warning-foreground",
    icon: IconAlertTriangle,
  },
  waiting: {
    label: "Not written yet",
    className: "bg-muted text-muted-foreground",
    icon: null,
  },
  not_needed: {
    label: "No reply needed",
    className:
      "bg-transparent text-muted-foreground ring-1 ring-inset ring-border",
    icon: null,
  },
};

export function DraftStatusChip({ status }: { status: DraftStatus }) {
  const style = DRAFT_STATUS[status];
  const Icon = style.icon;
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-[5px] px-1.5 text-[11.5px] font-medium leading-none",
        style.className,
      )}
    >
      {Icon ? (
        <Icon className="size-3.5" strokeWidth={2} aria-hidden="true" />
      ) : null}
      {style.label}
    </span>
  );
}

/** The board cell: subject and first lines of the draft, or why there is none. */
export function DraftPreview({ draft }: { draft: DraftSummary }) {
  if (draft.status === "ready" || draft.status === "needs_edit") {
    return (
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="min-w-0 truncate text-[13px] font-medium text-foreground">
            {draft.subject}
          </p>
          {draft.status === "needs_edit" ? (
            <DraftStatusChip status="needs_edit" />
          ) : null}
        </div>
        <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-[1.45] text-muted-foreground">
          {draft.preview}
        </p>
      </div>
    );
  }
  return (
    <p className="line-clamp-2 text-[12.5px] leading-[1.45] text-muted-foreground">
      {draft.status === "waiting" ? "Draft not written yet." : draft.note}
    </p>
  );
}

/** Renders the body as plain text, with the calendar placeholder as a chip. */
function DraftBody({ body }: { body: string }) {
  const parts = body.split(
    /(\[calendar link\]|\[time options\]|\[owner first name\])/i,
  );
  return (
    <div className="whitespace-pre-wrap text-[14px] leading-[1.6] text-foreground [overflow-wrap:anywhere]">
      {parts.map((part, index) =>
        /^\[(calendar link|time options|owner first name)\]$/i.test(part) ? (
          <span
            key={index}
            className="mx-0.5 inline-flex items-center gap-1 rounded-[5px] bg-secondary px-1.5 py-px align-baseline text-[12.5px] font-medium text-foreground ring-1 ring-inset ring-border"
            title={
              /time/i.test(part)
                ? "Two 30 minute time options the owner fills in before sending"
                : /owner/i.test(part)
                  ? "The owner's first name, once the lead is assigned"
                  : "The owner's calendar link is added when the email is sent"
            }
          >
            <IconCalendar className="size-3.5" aria-hidden="true" />
            {/time/i.test(part)
              ? "Time options"
              : /owner/i.test(part)
                ? "Owner's name"
                : "Calendar link"}
          </span>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </div>
  );
}

function Header({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-3 px-4 py-2 text-[13px]">
      <span className="w-14 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-foreground">{value}</span>
    </div>
  );
}

export function DraftCard({
  draft,
  onAsk,
}: {
  draft: DraftView;
  onAsk: (kind: "revise" | "draft") => void;
}) {
  const hasDraft = draft.status === "ready" || draft.status === "needs_edit";
  return (
    <section
      aria-label="Drafted reply"
      className="flex min-w-0 flex-col rounded-lg border border-border bg-card shadow-xs"
    >
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h2 className="text-[13px] font-semibold text-foreground">
          Drafted reply
        </h2>
        <div className="flex items-center gap-2">
          {draft.approach ? (
            <span
              className="text-[12px] text-muted-foreground"
              title="The Contact Sales class this reply follows, from the Sales handbook"
            >
              {draft.approach.label}
            </span>
          ) : null}
          <DraftStatusChip status={draft.status} />
        </div>
      </header>
      {hasDraft ? (
        <>
          <div className="divide-y divide-border border-b border-border">
            <Header
              label="To"
              value={
                <>
                  {draft.to.name ? `${draft.to.name} ` : null}
                  <span className="font-mono text-[12px] text-muted-foreground">
                    {draft.to.email}
                  </span>
                </>
              }
            />
            <Header label="From" value={draft.from ?? "Unassigned"} />
            <Header
              label="Subject"
              value={<span className="font-medium">{draft.subject}</span>}
            />
          </div>
          <div className="px-4 py-4">
            <DraftBody body={draft.body ?? ""} />
          </div>
          {draft.problems.length > 0 ? (
            <div className="mx-4 mb-4 rounded-md bg-warning-soft px-3 py-2.5">
              <p className="text-[12.5px] font-medium text-warning-foreground">
                Breaks {draft.problems.length} message{" "}
                {draft.problems.length === 1 ? "rule" : "rules"}
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12.5px] text-warning-foreground">
                {draft.problems.map((problem) => (
                  <li key={`${problem.code}-${problem.message}`}>
                    {problem.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {draft.warnings.length > 0 ? (
            <ul className="mx-4 mb-4 space-y-0.5 text-[12px] text-muted-foreground">
              {draft.warnings.map((warning) => (
                <li key={warning.code}>Note. {warning.message}</li>
              ))}
            </ul>
          ) : null}
          <footer className="mt-auto flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                const text = `Subject: ${draft.subject}\n\n${draft.body}`;
                void navigator.clipboard
                  .writeText(text)
                  .then(() => toast.success("Draft copied"))
                  .catch(() => toast.error("Couldn't copy the draft"));
              }}
            >
              <IconCopy className="size-4" aria-hidden="true" />
              Copy
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onAsk("revise")}
            >
              <IconPencil className="size-4" aria-hidden="true" />
              Ask agent to revise
            </Button>
            <span className="ml-auto text-[12px] text-muted-foreground">
              {draft.status === "ready"
                ? `Passes all ${draft.checksRun} message checks`
                : "Fix before it goes out"}
              {draft.wordCount !== null ? ` · ${draft.wordCount} words` : ""}
            </span>
          </footer>
          <div className="border-t border-border px-4 py-2 text-[11.5px] text-muted-foreground">
            <p>
              Proposed only. Nothing is sent automatically; sending with
              approval arrives in M2.
            </p>
            {draft.usedEntries.length > 0 ? (
              <CitationChips entries={draft.usedEntries} className="mt-1.5" />
            ) : null}
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-start gap-3 px-4 py-5">
          <p className="text-[13.5px] leading-relaxed text-muted-foreground">
            {draft.note}
          </p>
          {draft.status === "waiting" ? (
            <Button type="button" size="sm" onClick={() => onAsk("draft")}>
              <IconMessageCircleQuestion
                className="size-4"
                aria-hidden="true"
              />
              Ask agent to draft it
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** How the lead was classified, why, and what the PA does next. */
export function TriageCard({
  triage,
  asked,
  facts,
}: {
  triage: TriageView;
  asked: { text: string | null; source: "question" | "message" | null };
  facts: Array<{ label: string; value: string }>;
}) {
  return (
    <section
      aria-label="How it was classified"
      className="flex min-w-0 flex-col rounded-lg border border-border bg-card shadow-xs"
    >
      <header className="flex min-h-11 items-center border-b border-border px-4 py-2">
        <h2 className="text-[13px] font-semibold text-foreground">
          How it was classified
        </h2>
      </header>
      <div className="space-y-4 px-4 py-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <TriageBadge triage={triage} className="h-7 px-2.5 text-[13.5px]" />
            {triage.verdictLabel &&
            triage.verdictLabel !== triage.label &&
            triage.kind !== "owner" ? (
              <span className="text-[12px] text-muted-foreground">
                Verdict{" "}
                <span className="font-medium text-foreground">
                  {triage.verdictLabel}
                </span>
              </span>
            ) : null}
          </div>
          <p className="text-[14px] leading-relaxed text-foreground">
            {triage.why}
          </p>
        </div>
        <div>
          <p className="text-[11.5px] font-medium text-muted-foreground">
            {asked.source === "question" ? "They asked" : "Their message"}
          </p>
          {asked.text ? (
            <p className="pa-untrusted mt-1 border-l-2 border-foreground/25 pl-3 text-[13.5px] leading-relaxed text-foreground">
              {asked.text}
            </p>
          ) : (
            <p className="mt-1 text-[13px] text-muted-foreground">
              No message on the form.
            </p>
          )}
        </div>
        {facts.length > 0 ? (
          <dl className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px]">
            {facts.map((fact) => (
              <div key={fact.label} className="flex gap-1.5">
                <dt className="text-muted-foreground">{fact.label}</dt>
                <dd className="text-foreground">{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      <footer className="mt-auto border-t border-border bg-muted/40 px-4 py-3">
        <p className="text-[11.5px] font-medium text-muted-foreground">
          Next step
        </p>
        <p className="mt-0.5 text-[13.5px] font-medium text-foreground">
          {triage.action}
        </p>
      </footer>
    </section>
  );
}
