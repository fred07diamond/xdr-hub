// The two things a PA reads first on every lead (D49): how it was classified,
// and the drafted reply. Everything else on the record sits behind "Details".
import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import type {
  DecisionView,
  EngagementDetail,
  DraftStatus,
  DraftSummary,
  DraftView,
  LeadRouteView,
  TriageKind,
  TriageView,
} from "@shared/pa-views";
import {
  IconAlertTriangle,
  IconCalendar,
  IconCalendarEvent,
  IconCheck,
  IconCopy,
  IconMinus,
  IconX,
  IconMessageCircleQuestion,
  IconPencil,
} from "@tabler/icons-react";
import { Fragment, useState, type ReactNode } from "react";
import { Link } from "react-router";
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
  sent: {
    label: "Sent from HubSpot",
    className: "bg-primary-soft text-primary",
    icon: IconCheck,
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
  if (draft.status === "sent")
    return (
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="min-w-0 truncate text-[13px] font-medium text-foreground">
            {draft.subject ?? "(no subject)"}
          </p>
          <DraftStatusChip status="sent" />
        </div>
        <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-[1.45] text-muted-foreground">
          {draft.preview ?? draft.note}
        </p>
      </div>
    );
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
  sent,
  embedded = false,
}: {
  draft: DraftView;
  onAsk: (kind: "revise" | "draft") => void;
  /** The email already sent from HubSpot after the form (D64). */
  sent?: ReactNode;
  /** Inside another card (the first touch): no frame or header of its own. */
  embedded?: boolean;
}) {
  const hasDraft = draft.status === "ready" || draft.status === "needs_edit";
  return (
    <section
      aria-label="Drafted reply"
      className={cn(
        "flex min-w-0 flex-col",
        !embedded && "rounded-lg border border-border bg-card shadow-xs",
      )}
    >
      <header
        hidden={embedded}
        className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2"
      >
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
          {sent && !hasDraft ? (
            <span className="inline-flex h-[22px] items-center rounded-[5px] bg-primary-soft px-1.5 text-[11.5px] font-medium text-primary">
              Sent from HubSpot
            </span>
          ) : (
            <DraftStatusChip status={draft.status} />
          )}
        </div>
      </header>
      {sent}
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
            {draft.cc ? (
              <Header
                label="Cc"
                value={
                  <span className="font-mono text-[12px] text-muted-foreground">
                    {draft.cc}
                    <span className="ml-1.5 font-sans text-foreground">
                      (the AE)
                    </span>
                  </span>
                }
              />
            ) : null}
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
      ) : sent ? null : (
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
const ROUTE_CHOICES: Array<{ value: string; label: string }> = [
  { value: "route_to_ae", label: "Route to the AE" },
  { value: "pa_meeting", label: "PA takes the call" },
  { value: "qualify_first", label: "Qualify first" },
  { value: "clarify_once", label: "One clarification email" },
];

const shortLink = (link: string) =>
  link.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

/** After triage, who takes the meeting and whose link the email carries (D66). */
/**
 * Asked once (D72): the routed person has no meeting link on file. Saving it
 * keeps it on that person, so no lead routed to them asks again.
 */
function MeetingLinkField({
  who,
  onSaved,
}: {
  who: NonNullable<LeadRouteView["meetingWith"]>;
  onSaved?: () => void;
}) {
  const save = useActionMutation("set-meeting-link");
  const [link, setLink] = useState("");
  const name = who.name ?? who.email;
  return (
    <form
      className="mt-2 rounded-md border border-dashed border-amber-500/50 bg-amber-500/5 p-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(
          {
            email: who.email,
            meetingLink: link.trim(),
            displayName: who.name,
            role: who.role,
          },
          {
            onSuccess: () => {
              toast.success(
                `Saved ${name}'s meeting link. Leads routed to them use it from now on.`,
              );
              onSaved?.();
            },
            onError: (error) => toast.error(actionErrorMessage(error)),
          },
        );
      }}
    >
      <label className="grid gap-1">
        <span className="text-[12px] font-medium text-foreground">
          Add {name}'s meeting link
        </span>
        <span className="text-[11.5px] text-muted-foreground">
          Asked once. It is saved to {name} and used for every lead routed to
          them.
        </span>
        <span className="mt-1 flex gap-2">
          <input
            type="url"
            inputMode="url"
            required
            placeholder="https://meetings.hubspot.com/..."
            value={link}
            onChange={(event) => setLink(event.target.value)}
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-[13px] shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            type="submit"
            size="sm"
            disabled={save.isPending || !/^https:\/\/\S+$/.test(link.trim())}
          >
            {save.isPending ? "Saving..." : "Save"}
          </Button>
        </span>
      </label>
    </form>
  );
}

/**
 * Asked once (D72): an exceptional lead has no AE, because the account has no
 * AE owner and the PA has no pod AE. Saving makes this AE the PA's pod AE,
 * with their meeting link, so the PA's next leads route there too.
 */
function PodAeField({
  pa,
  onSaved,
}: {
  pa: NonNullable<LeadRouteView["paOwner"]>;
  onSaved?: () => void;
}) {
  const save = useActionMutation("set-meeting-link");
  const people = useActionQuery("list-people", {});
  const aes = (
    (
      people.data as
        | {
            people: Array<{
              email: string;
              displayName: string | null;
              role: string | null;
              meetingLink: string | null;
            }>;
          }
        | undefined
    )?.people ?? []
  ).filter((person) => person.role === "ae");
  const [email, setEmail] = useState("");
  const [link, setLink] = useState("");
  const known = aes.find((ae) => ae.email === email.trim().toLowerCase());
  const needsLink = !known?.meetingLink;
  const paName = pa.name ?? pa.email;
  const valid =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    (!needsLink || /^https:\/\/\S+$/.test(link.trim()));
  return (
    <form
      className="mt-2 rounded-md border border-dashed border-amber-500/50 bg-amber-500/5 p-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(
          {
            email: email.trim().toLowerCase(),
            meetingLink: (needsLink ? link : known!.meetingLink!).trim(),
            displayName: known?.displayName ?? null,
            role: "ae",
            podAeFor: pa.email,
          },
          {
            onSuccess: () => {
              toast.success(
                `Saved. ${paName}'s enterprise leads now route to this AE.`,
              );
              onSaved?.();
            },
            onError: (error) => toast.error(actionErrorMessage(error)),
          },
        );
      }}
    >
      <p className="text-[12px] font-medium text-foreground">
        Who is {paName}'s AE?
      </p>
      <p className="text-[11.5px] text-muted-foreground">
        Asked once. Saved as {paName}'s pod AE and used for every enterprise
        lead of theirs with no account AE.
      </p>
      <div className="mt-1.5 grid gap-1.5">
        <input
          type="email"
          list="pa-known-aes"
          required
          placeholder="AE email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-[13px] shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <datalist id="pa-known-aes">
          {aes.map((ae) => (
            <option key={ae.email} value={ae.email}>
              {ae.displayName ?? ae.email}
            </option>
          ))}
        </datalist>
        {needsLink ? (
          <input
            type="url"
            inputMode="url"
            placeholder="Their meeting link, https://meetings.hubspot.com/..."
            value={link}
            onChange={(event) => setLink(event.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-[13px] shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        ) : null}
        <div>
          <Button type="submit" size="sm" disabled={save.isPending || !valid}>
            {save.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </form>
  );
}

export function LeadRouteBlock({
  value,
  onChange,
  busy,
  onLinkSaved,
}: {
  value: LeadRouteView;
  onChange?: (route: string | null) => void;
  busy?: boolean;
  /** Set when the viewer can save a missing meeting link here. */
  onLinkSaved?: () => void;
}) {
  const who = value.meetingWith;
  const askForLink = Boolean(who && !who.link && onLinkSaved);
  const askForAe = Boolean(
    !who && value.route === "route_to_ae" && value.paOwner && onLinkSaved,
  );
  const hidden = (gap: string) =>
    (askForLink && /No meeting link/.test(gap)) ||
    (askForAe && /No AE for this lead/.test(gap));
  return (
    <div className="rounded-md border border-border px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11.5px] font-medium text-muted-foreground">Route</p>
        {onChange && value.canOverride ? (
          <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <span className="sr-only">Change the route</span>
            <select
              className="h-7 rounded-md border border-input bg-background px-1.5 text-[12.5px] text-foreground disabled:opacity-60"
              value={value.source === "override" ? value.route : ""}
              disabled={busy}
              onChange={(event) => onChange(event.target.value || null)}
            >
              <option value="">
                {value.source === "override"
                  ? "Back to the playbook's route"
                  : `Playbook: ${value.label}`}
              </option>
              {ROUTE_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <p className="mt-1 text-[14px] font-medium text-foreground">
        {value.label}
        {who ? (
          <span className="font-normal text-muted-foreground">
            {" "}
            with {who.name ?? who.email} ({who.role === "ae" ? "AE" : "PA"})
          </span>
        ) : null}
      </p>
      <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
        {value.email}
      </p>
      {who?.link ? (
        <a
          href={who.link}
          target="_blank"
          rel="noreferrer"
          className="mt-1.5 inline-flex max-w-full items-center gap-1 truncate text-[12.5px] text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
        >
          <IconCalendarEvent className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{shortLink(who.link)}</span>
        </a>
      ) : null}
      <p className="mt-1.5 text-[12px] text-muted-foreground">{value.reason}</p>
      {askForLink && who ? (
        <MeetingLinkField who={who} onSaved={onLinkSaved} />
      ) : null}
      {askForAe && value.paOwner ? (
        <PodAeField pa={value.paOwner} onSaved={onLinkSaved} />
      ) : null}
      {value.gaps.filter((gap) => !hidden(gap)).length > 0 ? (
        <ul className="mt-1.5 space-y-0.5">
          {value.gaps
            .filter((gap) => !hidden(gap))
            .map((gap) => (
              <li
                key={gap}
                className="flex gap-1.5 text-[12px] text-amber-700 dark:text-amber-400"
              >
                <IconAlertTriangle
                  className="mt-0.5 size-3.5 shrink-0"
                  aria-hidden="true"
                />
                <span>
                  {gap}{" "}
                  {/Team page/.test(gap) ? (
                    <Link to="/team" className="underline underline-offset-2">
                      Open Team
                    </Link>
                  ) : null}
                </span>
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The form message exactly as they wrote it, with the question PA picked out
 * of it underneath, so the card reads the same as HubSpot (D70).
 */
function TheirMessage({
  asked,
}: {
  asked: {
    text: string | null;
    source: "question" | "message" | null;
    message?: string | null;
  };
}) {
  const [open, setOpen] = useState(false);
  const message =
    asked.message ?? (asked.source === "message" ? asked.text : null);
  const question = asked.source === "question" ? asked.text : null;
  const long = (message?.length ?? 0) > 420;
  return (
    <div className="space-y-2">
      <div>
        <p className="text-[11.5px] font-medium text-muted-foreground">
          Their message
        </p>
        {message ? (
          <>
            <p
              className={cn(
                "pa-untrusted mt-1 whitespace-pre-line border-l-2 border-foreground/25 pl-3 text-[13.5px] leading-relaxed text-foreground",
                long && !open && "line-clamp-6",
              )}
            >
              {message}
            </p>
            {long ? (
              <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="mt-1 pl-3 text-[12px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {open ? "Show less" : "Show the whole message"}
              </button>
            ) : null}
          </>
        ) : (
          <p className="mt-1 text-[13px] text-muted-foreground">
            No message on the form.
          </p>
        )}
      </div>
      {question && question !== message ? (
        <p className="text-[12.5px] text-muted-foreground">
          <span className="font-medium text-foreground">They asked</span>{" "}
          <span className="pa-untrusted">{question}</span>
        </p>
      ) : null}
    </div>
  );
}

export function TriageCard({
  triage,
  asked,
  facts,
  contactSalesClass,
  leadRoute,
  onRouteChange,
  routeBusy,
  onLinkSaved,
}: {
  triage: TriageView;
  asked: {
    text: string | null;
    source: "question" | "message" | null;
    /** The whole form message; shown as written. */
    message?: string | null;
  };
  facts: Array<{ label: string; value: string }>;
  contactSalesClass?: ContactSalesClassView | null;
  leadRoute?: LeadRouteView | null;
  onRouteChange?: (route: string | null) => void;
  routeBusy?: boolean;
  onLinkSaved?: () => void;
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
          </div>
          <p className="text-[14px] leading-relaxed text-foreground">
            {triage.why}
          </p>
        </div>
        <TheirMessage asked={asked} />
        {contactSalesClass ? (
          <ContactSalesClassBlock value={contactSalesClass} />
        ) : null}
        {leadRoute ? (
          <LeadRouteBlock
            value={leadRoute}
            onChange={onRouteChange}
            busy={routeBusy}
            onLinkSaved={onLinkSaved}
          />
        ) : null}
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

function dueLabel(dueAt: string, now = Date.now()) {
  const minutes = Math.round((Date.parse(dueAt) - now) / 60_000);
  if (minutes <= 0) return "Past the 24 hour SLA";
  if (minutes < 60) return `Decide within ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `Decide within ${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
}

/** The rep's decision (workflow 2b, D59): PA's recommendation and the choices. */
export function DecisionBar({
  decision,
  onDecide,
  pending,
  onAsk,
  canDecide,
}: {
  decision: DecisionView;
  onDecide: (choice: string, note: string | null) => void;
  pending: boolean;
  onAsk: () => void;
  canDecide: boolean;
}) {
  const [note, setNote] = useState("");
  if (decision.status === "decided" && decision.choice) {
    return (
      <section
        aria-label="Decision"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-card px-4 py-3 text-[13px] shadow-xs"
      >
        <IconCheck className="size-4 text-primary" aria-hidden="true" />
        <span className="font-medium text-foreground">
          Decided: {decision.choice.label}
        </span>
        <span className="text-muted-foreground">
          {decision.decidedBy?.replace(/^user:/, "")}
          {decision.choice.code !== decision.recommendation.code
            ? ` · PA recommended ${decision.recommendation.label.toLowerCase()}`
            : " · as PA recommended"}
          {decision.slaMissedAt ? " · after the SLA" : ""}
        </span>
        {decision.note ? (
          <span className="w-full text-muted-foreground">
            Note. {decision.note}
          </span>
        ) : null}
      </section>
    );
  }
  const overdue = decision.overdue;
  return (
    <section
      aria-label="Your decision"
      className={cn(
        "rounded-lg border bg-card shadow-xs",
        overdue ? "border-destructive/40" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11.5px] font-medium text-muted-foreground">
            {decision.kind === "meeting_booked"
              ? "A meeting is booked. What should happen with it?"
              : "Your decision"}
            {" · "}
            <span
              className={cn(
                overdue ? "text-destructive-strong" : "text-foreground/80",
              )}
            >
              {dueLabel(decision.dueAt)}
            </span>
          </p>
          <p className="mt-0.5 text-[14px] text-foreground">
            PA recommends{" "}
            <span className="font-semibold">
              {decision.recommendation.label.toLowerCase()}
            </span>
            . {decision.reason}
          </p>
          {decision.question ? (
            <p className="mt-1 rounded-md bg-warning-soft px-2.5 py-1.5 text-[12.5px] text-warning-foreground">
              {decision.question}
            </p>
          ) : null}
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={onAsk}>
          <IconMessageCircleQuestion className="size-4" aria-hidden="true" />
          Pressure-test with the agent
        </Button>
      </div>
      {canDecide ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          {decision.options.map((option) => (
            <Button
              key={option.code}
              type="button"
              size="sm"
              variant={
                option.code === decision.recommendation.code
                  ? "default"
                  : "outline"
              }
              disabled={pending}
              onClick={() => onDecide(option.code, note.trim() || null)}
            >
              {option.label}
            </Button>
          ))}
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Note (optional)"
            maxLength={1000}
            aria-label="Decision note"
            className="h-8 min-w-[12rem] flex-1 rounded-md border border-input bg-background px-2.5 text-[13px] shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      ) : null}
      <p className="border-t border-border px-4 py-2 text-[11.5px] text-muted-foreground">
        Recorded in PA only; HubSpot is not changed and nothing is sent. Past 24
        hours the miss is recorded and flagged; nothing happens on its own.
      </p>
    </section>
  );
}

export function DecisionPill({ decision }: { decision: DecisionView | null }) {
  if (!decision) return null;
  if (decision.status === "decided")
    return (
      <span className="text-[11.5px] text-muted-foreground">
        {decision.choice?.label}
      </span>
    );
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-[4px] px-1.5 text-[11px] font-medium",
        decision.overdue
          ? "bg-destructive-soft text-destructive-strong"
          : "bg-secondary text-foreground",
      )}
      title={`PA recommends ${decision.recommendation.label.toLowerCase()}`}
    >
      {dueLabel(decision.dueAt).replace("Decide within", "Decide in")}
    </span>
  );
}

type ContactSalesClassView = NonNullable<EngagementDetail["contactSalesClass"]>;
type BriefView = NonNullable<EngagementDetail["brief"]>;

const MET_ICON = {
  true: { icon: IconCheck, className: "text-primary", label: "Met" },
  false: { icon: IconX, className: "text-muted-foreground", label: "Not met" },
  null: {
    icon: IconMinus,
    className: "text-muted-foreground",
    label: "Unknown",
  },
} as const;

/** The Contact Sales class and why (D61): shown on the classification card. */
export function ContactSalesClassBlock({
  value,
}: {
  value: ContactSalesClassView;
}) {
  return (
    <div className="rounded-md border border-border px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11.5px] font-medium text-muted-foreground">
          Qualification
          {value.tier && typeof value.signalsMet === "number"
            ? `, ${value.signalsMet} of 5 signals`
            : ""}
        </p>
        <span
          className={cn(
            "rounded-[5px] px-1.5 py-0.5 text-[12px] font-medium",
            value.tier === "exceptional"
              ? "bg-emerald-500/12 text-emerald-800 dark:text-emerald-300"
              : value.suggestRecycle
                ? "bg-amber-500/12 text-amber-800 dark:text-amber-300"
                : "bg-secondary text-foreground",
          )}
        >
          {value.label}
        </span>
      </div>
      <ul className="mt-2 space-y-1">
        {value.criteria.map((item) => {
          const style = MET_ICON[String(item.met) as "true" | "false" | "null"];
          const Icon = style.icon;
          return (
            <li key={item.label} className="flex gap-2 text-[12.5px]">
              <Icon
                className={cn("mt-0.5 size-3.5 shrink-0", style.className)}
                strokeWidth={2}
                aria-label={style.label}
              />
              <span className="min-w-0">
                <span className="text-foreground">{item.label}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {item.evidence}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
        {value.summary}
      </p>
    </div>
  );
}

const GATE_STYLE = {
  met: { label: "Met", className: "bg-primary-soft text-primary" },
  gap: { label: "Gap", className: "bg-warning-soft text-warning-foreground" },
  unknown: { label: "Unknown", className: "bg-muted text-muted-foreground" },
} as const;

/** The lead brief (D61): the CRM note and Stage 1 gate read, for the rep. */
export function LeadBriefCard({ brief }: { brief: BriefView | null }) {
  if (!brief)
    return (
      <section
        aria-label="Lead brief"
        className="rounded-lg border border-dashed border-border bg-card px-4 py-3 text-[13px] text-muted-foreground"
      >
        The lead brief (persona, V2 read, and the five Stage 1 gates) is written
        by the agent right before it drafts the reply.
      </section>
    );
  const met = brief.gates.filter((gate) => gate.status === "met").length;
  return (
    <section
      aria-label="Lead brief"
      className="rounded-lg border border-border bg-card shadow-xs"
    >
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h2 className="text-[13px] font-semibold text-foreground">
          Lead brief
          <span className="ml-2 font-normal text-muted-foreground">
            {met} of 5 Stage 1 gates met
          </span>
        </h2>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            void navigator.clipboard
              .writeText(brief.crmNote)
              .then(() =>
                toast.success("CRM note copied. Paste it into HubSpot."),
              )
              .catch(() => toast.error("Couldn't copy the note"))
          }
        >
          <IconCopy className="size-4" aria-hidden="true" />
          Copy CRM note
        </Button>
      </header>
      <div className="grid gap-4 px-4 py-4 @min-[60rem]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-3 text-[13px]">
          <p className="leading-relaxed text-foreground">{brief.summary}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
            <dt className="text-muted-foreground">Persona</dt>
            <dd className="text-foreground">{brief.persona}</dd>
            <dt className="text-muted-foreground">Deal role</dt>
            <dd className="text-foreground">{brief.dealRole}</dd>
            <dt className="text-muted-foreground">Use case</dt>
            <dd className="text-foreground">{brief.useCase}</dd>
            {brief.pathToEngineering ? (
              <>
                <dt className="text-muted-foreground">Path to eng</dt>
                <dd className="text-foreground">{brief.pathToEngineering}</dd>
              </>
            ) : null}
            {brief.v2Orientation ? (
              <>
                <dt className="text-muted-foreground">V2 read</dt>
                <dd className="text-foreground">{brief.v2Orientation}</dd>
              </>
            ) : null}
          </dl>
          <div>
            <p className="text-[11.5px] font-medium text-muted-foreground">
              Next step
            </p>
            <p className="text-foreground">{brief.nextStep}</p>
          </div>
          {brief.gapsRisks.length > 0 ? (
            <div>
              <p className="text-[11.5px] font-medium text-muted-foreground">
                Gaps and risks
              </p>
              <ul className="list-disc pl-4 text-foreground">
                {brief.gapsRisks.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <ul className="space-y-2">
          {brief.gates.map((gate) => (
            <li
              key={gate.gate}
              className="rounded-md border border-border px-3 py-2 text-[12.5px]"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-foreground">
                  {gate.label}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-[4px] px-1.5 py-0.5 text-[11px] font-medium",
                    GATE_STYLE[gate.status].className,
                  )}
                >
                  {GATE_STYLE[gate.status].label}
                </span>
              </div>
              <p className="mt-0.5 text-muted-foreground">{gate.evidence}</p>
              {gate.nextMove ? (
                <p className="mt-0.5 text-foreground">Next. {gate.nextMove}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
