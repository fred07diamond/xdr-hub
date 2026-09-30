import type { TimelineItem } from "@shared/pa-views";
import { IconReceipt } from "@tabler/icons-react";

import { formatDateTime } from "@/lib/format";

export function Timeline({
  items,
  onOpenReceipt,
}: {
  items: TimelineItem[];
  onOpenReceipt: (receiptId: string) => void;
}) {
  if (items.length === 0) {
    return <p className="text-[13px] text-muted-foreground">No events yet.</p>;
  }
  return (
    <ol className="relative">
      {items.map((item, index) => (
        <li key={item.id} className="relative flex gap-3 pb-4 last:pb-0">
          {index < items.length - 1 ? (
            <span
              aria-hidden="true"
              className="absolute left-[4.5px] top-3 h-full w-px bg-border"
            />
          ) : null}
          <span
            aria-hidden="true"
            className="relative mt-[5px] size-2.5 shrink-0 rounded-full border-2 border-card bg-foreground/45 ring-1 ring-border"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <p className="text-[13px] font-medium text-foreground">
                {item.label}
              </p>
              <time
                dateTime={item.at}
                className="text-[11.5px] tabular-nums text-muted-foreground"
              >
                {formatDateTime(item.at)}
              </time>
            </div>
            {item.detail ? (
              <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                {item.detail}
              </p>
            ) : null}
            <div className="mt-1 flex items-center gap-3 text-[11.5px] text-muted-foreground">
              <span>{item.actor === "system" ? "System" : item.actor}</span>
              {item.receiptId ? (
                <button
                  type="button"
                  onClick={() => onOpenReceipt(item.receiptId as string)}
                  className="inline-flex items-center gap-1 rounded-[4px] text-foreground/80 underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <IconReceipt
                    className="size-3.5"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  Receipt
                </button>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
