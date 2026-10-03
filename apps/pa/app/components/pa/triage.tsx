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
  IconDots,
  IconMinus,
  IconX,
  IconMessageCircleQuestion,
  IconLoader2,
  IconRefresh,
} from "@tabler/icons-react";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { CitationChips } from "./badges";
import { SendBar } from "./send-bar";

const KIND_STYLES: Record<TriageKind, string> = {
  reply: "bg-teal-500/10 text-teal-800 ring-teal-600/25 dark:text-teal-300",
  review: "bg-rose-500/10 text-rose-800 ring-rose-600/25 dark:text-rose-300",
  owner: "bg-secondary text-foreground ring-border",
  elsewhere:
    "bg-slate-500/10 text-slate-700 ring-slate-500/25 dark:text-slate-300",
  closed: "bg-transparent text-muted-foreground ring-border",
  pending: "bg-muted text-muted-foreground ring-border",
};

/**
 * One color per classification, so each reads at a glance on the board
 * (Fred, 2026-10-01). Labels are PA's own fixed set; anything else falls
 * back to its kind.
 */
const LABEL_STYLES: Record<string, string> = {
  Exceptional:
    "bg-emerald-500/12 text-emerald-800 ring-emerald-600/30 dark:text-emerald-300",
  "Requires discovery":
    "bg-sky-500/12 text-sky-800 ring-sky-600/30 dark:text-sky-300",
  "Suggest recycle":
    "bg-amber-500/14 text-amber-900 ring-amber-600/35 dark:text-amber-300",
  "Partnership ask, recycle":
    "bg-orange-500/12 text-orange-800 ring-orange-600/30 dark:text-orange-300",
  Actioned:
    "bg-slate-500/10 text-slate-700 ring-slate-500/25 dark:text-slate-300",
  "AE-owned account":
    "bg-violet-500/12 text-violet-800 ring-violet-600/30 dark:text-violet-300",
  "Existing customer":
    "bg-indigo-500/12 text-indigo-800 ring-indigo-600/30 dark:text-indigo-300",
  "Open deal":
    "bg-indigo-500/12 text-indigo-800 ring-indigo-600/30 dark:text-indigo-300",
  "Check before replying":
    "bg-rose-500/12 text-rose-800 ring-rose-600/30 dark:text-rose-300",
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
        "inline-flex h-[22px] max-w-full items-center whitespace-nowrap rounded-[5px] px-2 text-[12px] font-medium leading-none ring-1 ring-inset",
        LABEL_STYLES[triage.label] ?? KIND_STYLES[triage.kind],
        className,
      )}
    >
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

/**
 * Why the agent wrote the draft this way (D85): the class and route, the
 * TCQ parts in its own words, how it answered each ask, and the tone.
 */
function DraftReasoning({ draft }: { draft: DraftView }) {
  const why = draft.reasoning;
  const tcq = draft.rubric;
  if (!draft.body) return null;
  if (!why && !tcq)
    return (
      <p className="border-t border-border bg-muted/30 px-4 py-2.5 text-[12px] text-muted-foreground">
        No reasoning on this draft: it was written before PA asked the agent to
        explain its drafts. The agent rewrites it under the current rules, and
        the new draft shows why it reads the way it does.
      </p>
    );
  const row = (label: string, quote: string | null, note: string | null) =>
    quote || note ? (
      <div className="grid gap-0.5 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:gap-3">
        <dt className="text-[11.5px] font-medium text-muted-foreground">
          {label}
        </dt>
        <dd className="min-w-0 text-[12.5px] leading-relaxed text-foreground">
          {quote ? (
            <span className="pa-untrusted block border-l-2 border-foreground/20 pl-2">
              {quote}
            </span>
          ) : null}
          {note ? (
            <span className="block text-muted-foreground">{note}</span>
          ) : null}
        </dd>
      </div>
    ) : null;
  return (
    <details className="group border-t border-border bg-muted/30">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5 text-[12.5px] font-medium text-foreground">
        Why it reads this way
        <span className="text-[11.5px] font-normal text-muted-foreground group-open:hidden">
          Show
        </span>
        <span className="hidden text-[11.5px] font-normal text-muted-foreground group-open:inline">
          Hide
        </span>
      </summary>
      <dl className="grid gap-2.5 px-4 pb-4">
        {row("Class and route", null, why?.approach ?? null)}
        {row("Acknowledgment", null, why?.acknowledgment ?? null)}
        {row("Trigger", tcq?.trigger ?? null, why?.trigger ?? null)}
        {row("Connection", tcq?.connection ?? null, why?.connection ?? null)}
        {row("Question", tcq?.ask ?? null, why?.question ?? null)}
        {why?.asks.length ? (
          <div className="grid gap-0.5 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:gap-3">
            <dt className="text-[11.5px] font-medium text-muted-foreground">
              Their asks
            </dt>
            <dd>
              <ul className="space-y-1 text-[12.5px] leading-relaxed">
                {why.asks.map((item) => (
                  <li key={item.asked}>
                    <span className="pa-untrusted block text-foreground">
                      {item.asked}
                    </span>
                    <span className="block text-muted-foreground">
                      {item.answer}
                    </span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
        {row("Tone", null, why?.tone ?? null)}
        {draft.warnings.length > 0 ? (
          <ul className="space-y-0.5 text-[12px] text-muted-foreground">
            {draft.warnings.map((warning) => (
              <li key={warning.code}>Note. {warning.message}</li>
            ))}
          </ul>
        ) : null}
        {draft.usedEntries.length > 0 ? (
          <div className="grid gap-1">
            <p className="text-[11.5px] font-medium text-muted-foreground">
              Playbook rules it follows
            </p>
            <CitationChips entries={draft.usedEntries} />
          </div>
        ) : null}
        {!why ? (
          <p className="text-[12px] text-muted-foreground">
            Written before PA asked for the agent's reasoning; the next draft
            includes it.
          </p>
        ) : null}
      </dl>
    </details>
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

/** "[owner first name]" reads as the owner's name in the editor (D100). */
const OWNER_TOKEN = /\[owner first name\]/gi;

export function DraftCard({
  draft,
  engagementId,
  editable = false,
  onChanged,
  onAsk,
  onRewrite,
  rewriteBusy,
}: {
  draft: DraftView;
  /** With it, the owner can approve and send from their Gmail (D96). */
  engagementId?: string;
  /** People with a PA role can edit the subject and body in place (D100). */
  editable?: boolean;
  /** After a save, send, or approval, so the page reloads the lead. */
  onChanged?: () => void;
  onAsk: (kind: "revise" | "draft") => void;
  /** Rewrite just this reply under the current playbook (D87). */
  onRewrite?: () => void;
  rewriteBusy?: boolean;
}) {
  const hasDraft = draft.status === "ready" || draft.status === "needs_edit";
  const ownerFirst = draft.from?.trim().split(/\s+/)[0] ?? null;
  const initialBody = ownerFirst
    ? (draft.body ?? "").replace(OWNER_TOKEN, ownerFirst)
    : (draft.body ?? "");
  const initialSubject = draft.subject ?? "";
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  // A new draft (agent rewrite or a saved edit) replaces what is on screen.
  useEffect(() => {
    setSubject(initialSubject);
    setBody(initialBody);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id]);
  const save = useActionMutation("edit-draft");
  const dirty = subject !== initialSubject || body !== initialBody;
  const canEdit =
    editable &&
    Boolean(engagementId && draft.id) &&
    !draft.rewriting &&
    draft.send?.delivery?.kind !== "sent" &&
    draft.send?.delivery?.kind !== "sending";

  const saveEdit = () =>
    save.mutate(
      {
        engagementId: engagementId ?? "",
        draftId: draft.id ?? "",
        subject: subject.trim(),
        body: body.trim(),
      },
      {
        onSuccess: (result) => {
          const problems = (result as { problems?: unknown[] }).problems ?? [];
          if (problems.length > 0)
            toast.warning(
              `Saved. It breaks ${problems.length} message ${problems.length === 1 ? "rule" : "rules"}; fix it before it goes out.`,
            );
          else toast.success("Saved your edits.");
          onChanged?.();
        },
        onError: (error) => toast.error(actionErrorMessage(error)),
      },
    );

  const menu = hasDraft ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label="More"
        >
          <IconDots className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => {
            void navigator.clipboard
              .writeText(`Subject: ${subject}\n\n${body}`)
              .then(() => toast.success("Draft copied"))
              .catch(() => toast.error("Couldn't copy the draft"));
          }}
        >
          <IconCopy className="size-4" aria-hidden="true" />
          Copy
        </DropdownMenuItem>
        {onRewrite ? (
          <DropdownMenuItem
            disabled={rewriteBusy || draft.rewriting || dirty}
            onSelect={onRewrite}
          >
            <IconRefresh className="size-4" aria-hidden="true" />
            Rewrite with the agent
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  const meta = (
    <span className="whitespace-nowrap text-[12px] text-muted-foreground">
      {draft.wordCount !== null ? `${draft.wordCount} words` : ""}
    </span>
  );

  return (
    <section
      aria-label="Drafted reply"
      className="flex min-w-0 flex-col rounded-lg border border-border bg-card shadow-xs"
    >
      <header className="flex min-h-11 items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h2 className="text-[13px] font-semibold text-foreground">
          Drafted reply
        </h2>
        <DraftStatusChip status={draft.status} />
      </header>
      {hasDraft ? (
        <>
          <p className="truncate px-4 pt-3 text-[12.5px] text-muted-foreground">
            To{" "}
            <span className="text-foreground">
              {draft.to.name ?? draft.to.email}
            </span>
            {draft.to.name ? (
              <span className="font-mono text-[11.5px]"> {draft.to.email}</span>
            ) : null}
            {draft.cc ? (
              <>
                {"  ·  "}Cc <span className="text-foreground">{draft.cc}</span>{" "}
                (the AE)
              </>
            ) : null}
          </p>
          {draft.rewriting ? (
            <p className="mx-4 mt-3 flex items-center gap-2 rounded-md bg-primary-soft px-3 py-2 text-[12.5px] text-primary">
              <IconLoader2
                className="size-3.5 animate-spin"
                aria-hidden="true"
              />
              The agent is rewriting this reply. The new draft replaces it in a
              minute or two.
            </p>
          ) : null}
          {canEdit ? (
            <div className="flex flex-1 flex-col px-4 pb-2 pt-2">
              <input
                aria-label="Subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 -mx-1.5 text-[14px] font-semibold text-foreground outline-none hover:border-border focus:border-ring"
              />
              <textarea
                aria-label="Email body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={8}
                className="mt-1 w-full flex-1 resize-none rounded-md border border-transparent bg-transparent px-1.5 py-1 -mx-1.5 text-[14px] min-h-48 leading-[1.6] text-foreground outline-none [field-sizing:content] hover:border-border focus:border-ring"
              />
            </div>
          ) : (
            <div className="flex-1 px-4 pb-4 pt-2">
              <p className="mb-2 text-[14px] font-semibold text-foreground">
                {draft.subject}
              </p>
              <DraftBody body={draft.body ?? ""} />
            </div>
          )}
          {draft.problems.length > 0 && !dirty ? (
            <div className="mx-4 mb-3 rounded-md bg-warning-soft px-3 py-2.5">
              <p className="text-[12.5px] font-medium text-warning-foreground">
                Fix before it goes out
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
          {dirty ? (
            <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
              <Button
                type="button"
                size="sm"
                disabled={save.isPending || !subject.trim() || !body.trim()}
                onClick={saveEdit}
              >
                {save.isPending ? (
                  <IconLoader2
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <IconCheck className="size-4" aria-hidden="true" />
                )}
                Save changes
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={save.isPending}
                onClick={() => {
                  setSubject(initialSubject);
                  setBody(initialBody);
                }}
              >
                Discard
              </Button>
              <span className="ml-auto text-[12px] text-muted-foreground">
                Save before you send. PA checks it against the message rules.
              </span>
            </div>
          ) : engagementId ? (
            <SendBar
              engagementId={engagementId}
              draft={draft}
              onDone={() => onChanged?.()}
              trailing={
                <>
                  {meta}
                  {menu}
                </>
              }
            />
          ) : (
            <div className="mt-auto flex items-center justify-end gap-2 border-t border-border px-4 py-2">
              {meta}
              {menu}
            </div>
          )}
          <DraftReasoning draft={draft} />
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
 * Asked once (D77, D78): an exceptional lead with no AE owner needs the
 * Commercial AE, or an Enterprise AE for the round robin, and none is set.
 * Saving adds them with their meeting link, so no lead asks again.
 */
function AeSetupField({
  pa,
  onSaved,
  mode = "enterprise_ae",
}: {
  pa: NonNullable<LeadRouteView["paOwner"]> | null;
  onSaved?: () => void;
  /** enterprise_ae: adds an AE to the round robin (D78). commercial_ae: the commercial AE (D77). partnerships: the Partnerships contact (D81). */
  mode?: "enterprise_ae" | "commercial_ae" | "partnerships";
}) {
  const commercial = mode === "commercial_ae";
  const partnerships = mode === "partnerships";
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
  ).filter((person) =>
    partnerships
      ? person.role === "partnerships"
      : commercial
        ? person.role === "commercial_ae" || person.role === "ae"
        : person.role === "ae",
  );
  const [email, setEmail] = useState("");
  const [link, setLink] = useState("");
  const known = aes.find((ae) => ae.email === email.trim().toLowerCase());
  const needsLink = !known?.meetingLink;
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
            role: partnerships
              ? "partnerships"
              : commercial
                ? "commercial_ae"
                : "ae",
            podAeFor: null,
          },
          {
            onSuccess: () => {
              toast.success(
                partnerships
                  ? "Saved. Exceptional partnership asks now route to them."
                  : commercial
                    ? "Saved. Exceptional leads at commercial accounts now route to this AE."
                    : "Saved. This AE is in the enterprise round robin now.",
              );
              onSaved?.();
            },
            onError: (error) => toast.error(actionErrorMessage(error)),
          },
        );
      }}
    >
      <p className="text-[12px] font-medium text-foreground">
        {partnerships
          ? "Who handles partnerships?"
          : commercial
            ? "Who is the commercial AE?"
            : "Add an enterprise AE"}
      </p>
      <p className="text-[11.5px] text-muted-foreground">
        {partnerships
          ? "Asked once. Saved as the Partnerships contact and used for every exceptional partnership ask."
          : commercial
            ? "Asked once. Saved as the Commercial AE and used for every exceptional lead at a commercial account."
            : "Asked once. No enterprise AEs are set up yet; this one joins the round robin for accounts over the commercial line with no AE owner."}
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
  const askForCommercial = Boolean(
    !who && value.needs === "commercial_ae" && onLinkSaved,
  );
  const askForAe = Boolean(
    !who && value.needs === "enterprise_ae" && onLinkSaved,
  );
  const askForPartners = Boolean(
    !who && value.needs === "partnerships" && onLinkSaved,
  );
  const hidden = (gap: string) =>
    (askForLink && /No meeting link/.test(gap)) ||
    (askForAe && /No enterprise AEs/.test(gap)) ||
    (askForCommercial && /No commercial AE/.test(gap)) ||
    (askForPartners && /No Partnerships contact/.test(gap));
  return (
    <div className="rounded-md border border-border px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
          Route
          {value.segment && value.route === "route_to_ae" ? (
            <span className="rounded-[4px] bg-secondary px-1.5 py-px text-[11px] font-medium text-foreground">
              {value.segment === "commercial"
                ? "Commercial account"
                : "Enterprise account"}
            </span>
          ) : null}
        </p>
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
      {askForAe ? (
        <AeSetupField pa={value.paOwner} onSaved={onLinkSaved} />
      ) : null}
      {askForPartners ? (
        <AeSetupField
          pa={value.paOwner}
          onSaved={onLinkSaved}
          mode="partnerships"
        />
      ) : null}
      {askForCommercial ? (
        <AeSetupField
          pa={value.paOwner}
          onSaved={onLinkSaved}
          mode="commercial_ae"
        />
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
                  {/Settings, Lead routing/.test(gap) ? (
                    <Link
                      to="/settings/lead-routing"
                      className="underline underline-offset-2"
                    >
                      Open lead routing
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
                ? "bg-amber-500/14 text-amber-900 dark:text-amber-300"
                : value.tier === "discovery"
                  ? "bg-sky-500/12 text-sky-800 dark:text-sky-300"
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
