// Small pieces shared by the sequence builder and the enroll panel (D105).
import {
  SEQUENCE_KIND_LABELS,
  TEMPLATE_TOKENS,
  type SequenceKind,
} from "@shared/sequences";
import {
  IconArrowBackUp,
  IconMailPlus,
  IconSparkles,
  IconTemplate,
} from "@tabler/icons-react";
import { Fragment } from "react";

import { cn } from "@/lib/utils";

const TOKEN_LABEL = Object.fromEntries(
  TEMPLATE_TOKENS.map((item) => [item.token, item.label]),
) as Record<string, string>;

/** Text with {{tokens}} shown as chips, like HubSpot's merge fields. */
export function TokenText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const parts = text.split(/(\{\{\s*[a-z_]+\s*\}\})/g);
  return (
    <span className={cn("whitespace-pre-wrap", className)}>
      {parts.map((part, index) => {
        const match = /^\{\{\s*([a-z_]+)\s*\}\}$/.exec(part);
        return match ? (
          <span
            key={index}
            className="mx-0.5 inline-flex items-center rounded-[5px] border border-border bg-muted/60 px-1.5 py-px align-baseline text-[0.92em] font-medium text-foreground"
          >
            {TOKEN_LABEL[match[1]] ?? match[1]}
          </span>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        );
      })}
    </span>
  );
}

export function KindChip({ kind }: { kind: SequenceKind }) {
  const Icon = kind === "dynamic" ? IconSparkles : IconTemplate;
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-[5px] px-1.5 text-[11.5px] font-medium",
        kind === "dynamic"
          ? "bg-primary-soft text-primary"
          : "bg-muted text-foreground ring-1 ring-inset ring-border",
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {SEQUENCE_KIND_LABELS[kind]}
    </span>
  );
}

export function ThreadChip({ thread }: { thread: "reply" | "new" }) {
  const Icon = thread === "reply" ? IconArrowBackUp : IconMailPlus;
  return (
    <span className="inline-flex h-[20px] items-center gap-1 rounded-full bg-muted px-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
      <Icon className="size-3" aria-hidden="true" />
      {thread === "reply" ? "Reply" : "New email"}
    </span>
  );
}

/** "Delay: 2 days" between two steps. */
export function DelayPill({ days }: { days: number }) {
  return (
    <div className="flex flex-col items-center py-1" aria-hidden="true">
      <span className="h-4 w-px bg-border" />
      <span className="rounded-full border border-border bg-card px-3 py-1 text-[12px] text-muted-foreground">
        {days <= 0
          ? "Same day"
          : `Delay: ${days} ${days === 1 ? "day" : "days"}`}
      </span>
      <span className="h-4 w-px bg-border" />
    </div>
  );
}
