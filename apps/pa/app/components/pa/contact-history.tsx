// The lead's contact history from HubSpot (D64): what was already sent and
// every other touch, so the draft never disappears into a guess.
import { useActionQuery } from "@agent-native/core/client/hooks";
import {
  IconArrowDownLeft,
  IconArrowUpRight,
  IconCalendarEvent,
  IconMail,
  IconNote,
  IconPhone,
  IconRobot,
} from "@tabler/icons-react";
import { useState } from "react";

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
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className={cn(
              "pa-untrusted mt-0.5 block w-full text-left text-[12.5px] leading-relaxed text-muted-foreground",
              !open && "line-clamp-2",
            )}
            aria-expanded={open}
          >
            {item.preview}
          </button>
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

/** The email sent from HubSpot after the form, shown in the draft card. */
export function SentEmail({ email }: { email: HistoryItem }) {
  return (
    <div className="border-b border-border bg-primary-soft/40 px-4 py-3">
      <p className="text-[11.5px] font-medium text-primary">
        Already contacted from HubSpot
        {email.at ? ` · ${formatDateTime(email.at)}` : ""}
        {email.from ? ` · ${email.from}` : ""}
      </p>
      {email.title ? (
        <p className="mt-1 text-[13.5px] font-medium text-foreground">
          {email.title}
        </p>
      ) : null}
      {email.preview ? (
        <p className="pa-untrusted mt-1 text-[13px] leading-relaxed text-foreground/90">
          {email.preview}
        </p>
      ) : null}
    </div>
  );
}
