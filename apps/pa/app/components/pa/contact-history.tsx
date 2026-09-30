// The lead's contact history from HubSpot (D64): what was already sent and
// every other touch, so the draft never disappears into a guess.
import { useActionQuery } from "@agent-native/core/client/hooks";
import {
  IconArrowDownLeft,
  IconCheck,
  IconChevronDown,
  IconArrowUpRight,
  IconCalendarEvent,
  IconMail,
  IconNote,
  IconPhone,
  IconRobot,
} from "@tabler/icons-react";
import { useState, type ReactNode } from "react";

import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface HistoryItem {
  id: string;
  kind: "email" | "call" | "meeting" | "note" | "dobby";
  direction: "outbound" | "inbound" | null;
  at: string | null;
  title: string | null;
  preview: string | null;
  from: string | null;
  to: string | null;
  status: string | null;
}

export interface HistoryResult {
  available: boolean;
  items: HistoryItem[];
  unavailable: Array<{ kind: string; reason: string }>;
  firstTouch: HistoryItem | null;
}

const KIND = {
  email: { icon: IconMail, label: "Email" },
  call: { icon: IconPhone, label: "Call" },
  meeting: { icon: IconCalendarEvent, label: "Meeting" },
  note: { icon: IconNote, label: "Note" },
  dobby: { icon: IconRobot, label: "Dobby" },
} as const;

export function useContactHistory(engagementId: string, enabled: boolean) {
  return useActionQuery(
    "get-contact-history",
    { engagementId },
    { enabled, staleTime: 60_000 },
  );
}

function Item({ item }: { item: HistoryItem }) {
  const [open, setOpen] = useState(false);
  const kind = KIND[item.kind];
  const Icon = kind.icon;
  const DirectionIcon =
    item.direction === "inbound" ? IconArrowDownLeft : IconArrowUpRight;
  return (
    <li className="flex gap-3 py-2.5">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary ring-1 ring-border">
        <Icon className="size-3.5 text-foreground" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px]">
          <span className="font-medium text-foreground">{kind.label}</span>
          {item.direction ? (
            <span className="inline-flex items-center gap-0.5 text-muted-foreground">
              <DirectionIcon className="size-3" aria-hidden="true" />
              {item.direction === "inbound" ? "From the lead" : "From us"}
            </span>
          ) : null}
          {item.from || item.to ? (
            <span className="truncate text-muted-foreground">
              {[item.from, item.to].filter(Boolean).join(" to ")}
            </span>
          ) : null}
          <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
            {item.at ? formatDateTime(item.at) : "No date"}
            {item.status ? ` · ${item.status.toLowerCase()}` : ""}
          </span>
        </div>
        {item.title ? (
          <p className="mt-0.5 text-[13px] font-medium text-foreground">
            {item.title}
          </p>
        ) : null}
        {item.preview ? (
          open ? (
            <div className="mt-1 rounded-md bg-muted/50 px-3 py-2">
              <EmailText text={item.preview} className="text-[13px]" />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="mt-1 text-[12px] font-medium text-muted-foreground hover:text-foreground"
              >
                Show less
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="pa-untrusted mt-0.5 line-clamp-2 block w-full text-left text-[12.5px] leading-relaxed text-muted-foreground"
              aria-expanded={false}
            >
              {item.preview.replace(/\s+/g, " ")}
            </button>
          )
        ) : null}
      </div>
    </li>
  );
}

/** Every touch on the contact in HubSpot, newest first. */
export function ContactHistoryCard({
  query,
}: {
  query: ReturnType<typeof useContactHistory>;
}) {
  const data = query.data as HistoryResult | undefined;
  return (
    <section
      aria-label="Contact history"
      className="rounded-lg border border-border bg-card shadow-xs"
    >
      <header className="flex min-h-11 items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h2 className="text-[13px] font-semibold text-foreground">
          Contact history
          <span className="ml-2 font-normal text-muted-foreground">
            from HubSpot
          </span>
        </h2>
        {data ? (
          <span className="text-[12px] tabular-nums text-muted-foreground">
            {data.items.length} {data.items.length === 1 ? "touch" : "touches"}
          </span>
        ) : null}
      </header>
      <div className="px-4 py-1">
        {query.isPending ? (
          <p className="py-3 text-[13px] text-muted-foreground">
            Reading HubSpot...
          </p>
        ) : !data ? (
          <p className="py-3 text-[13px] text-muted-foreground">
            Couldn't read the history from HubSpot.
          </p>
        ) : data.items.length === 0 ? (
          <p className="py-3 text-[13px] text-muted-foreground">
            No emails, calls, meetings, or notes on this contact yet.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {data.items.map((item) => (
              <Item key={item.id} item={item} />
            ))}
          </ul>
        )}
        {data && data.unavailable.length > 0 ? (
          <p className="border-t border-border py-2 text-[11.5px] text-muted-foreground">
            HubSpot did not return{" "}
            {data.unavailable.map((item) => `${item.kind}s`).join(", ")}; the
            token may lack that scope.
          </p>
        ) : null}
      </div>
    </section>
  );
}

const URL_PATTERN = /(https?:\/\/[^\s<>"')\]]+)/g;

function shortUrl(url: string) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, "");
    const shown = `${parsed.host.replace(/^www\./, "")}${path}`;
    return shown.length > 42 ? `${shown.slice(0, 41)}...` : shown;
  } catch {
    return url.length > 42 ? `${url.slice(0, 41)}...` : url;
  }
}

/** Email text as written: paragraphs kept, links short and clickable. */
export function EmailText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const parts = text.split(URL_PATTERN);
  return (
    <div
      className={cn(
        "pa-untrusted whitespace-pre-wrap text-[14px] leading-[1.6] text-foreground [overflow-wrap:anywhere]",
        className,
      )}
    >
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noreferrer noopener"
            title={part}
            className="text-primary underline underline-offset-2"
          >
            {shortUrl(part)}
          </a>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-3 px-4 py-2 text-[13px]">
      <span className="w-14 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-foreground">{value}</span>
    </div>
  );
}

/**
 * The first touch that already went out from HubSpot (D64), shown the way a
 * draft is: an email, with PA's own draft tucked underneath for comparison.
 */
export function FirstTouchCard({
  email,
  lead,
  children,
}: {
  email: HistoryItem;
  lead: { name: string | null; email: string };
  children?: ReactNode;
}) {
  return (
    <section
      aria-label="First touch"
      className="flex min-w-0 flex-col rounded-lg border border-border bg-card shadow-xs"
    >
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h2 className="text-[13px] font-semibold text-foreground">
          First touch
        </h2>
        <span className="inline-flex h-[22px] items-center gap-1 rounded-[5px] bg-primary-soft px-1.5 text-[11.5px] font-medium text-primary">
          <IconCheck className="size-3.5" strokeWidth={2} aria-hidden="true" />
          Sent from HubSpot
        </span>
      </header>
      <div className="divide-y divide-border border-b border-border">
        <Row
          label="To"
          value={
            <>
              {lead.name ? `${lead.name} ` : null}
              <span className="font-mono text-[12px] text-muted-foreground">
                {lead.email}
              </span>
            </>
          }
        />
        <Row label="From" value={email.from ?? "Unknown sender"} />
        <Row
          label="Sent"
          value={email.at ? formatDateTime(email.at) : "Unknown"}
        />
        <Row
          label="Subject"
          value={
            <span className="font-medium">{email.title ?? "(no subject)"}</span>
          }
        />
      </div>
      <div className="px-4 py-4">
        {email.preview ? (
          <EmailText text={email.preview} />
        ) : (
          <p className="text-[13px] text-muted-foreground">
            HubSpot did not return the email text.
          </p>
        )}
      </div>
      <p className="border-t border-border px-4 py-2 text-[11.5px] text-muted-foreground">
        First contact is marked done on the SLA timer. PA does not draft another
        first touch for this lead.
      </p>
      {children ? (
        <details className="group border-t border-border">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-[12.5px] font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <IconChevronDown
              className="size-4 -rotate-90 text-muted-foreground transition-transform group-open:rotate-0"
              aria-hidden="true"
            />
            PA's draft, not sent
          </summary>
          <div className="border-t border-border">{children}</div>
        </details>
      ) : null}
    </section>
  );
}
