import { IconLock } from "@tabler/icons-react";

import { cn } from "@/lib/utils";

interface Flag {
  pattern: string;
  text: string;
}

function segments(text: string, flags: Flag[]) {
  const ranges: Array<[number, number, string]> = [];
  for (const flag of flags) {
    if (!flag.text) continue;
    let from = 0;
    while (from <= text.length) {
      const at = text.indexOf(flag.text, from);
      if (at < 0) break;
      ranges.push([at, at + flag.text.length, flag.pattern]);
      from = at + flag.text.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number, string]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([...range]);
    }
  }
  const parts: Array<{ text: string; flagged: string | null }> = [];
  let cursor = 0;
  for (const [start, end, pattern] of merged) {
    if (start > cursor)
      parts.push({ text: text.slice(cursor, start), flagged: null });
    parts.push({ text: text.slice(start, end), flagged: pattern });
    cursor = end;
  }
  if (cursor < text.length)
    parts.push({ text: text.slice(cursor), flagged: null });
  return parts;
}

/** Renders outside-party text as inert data: escaped by React, never linkified. */
export function UntrustedText({
  text,
  flags = [],
  label = "Form message",
  className,
}: {
  text: string | null;
  flags?: Flag[];
  label?: string;
  className?: string;
}) {
  return (
    <figure
      className={cn(
        "overflow-hidden rounded-md border border-border bg-muted/45",
        className,
      )}
    >
      <figcaption className="flex items-center justify-between gap-3 border-b border-border px-3 py-1.5">
        <span className="text-[11.5px] font-medium text-muted-foreground">
          {label}
        </span>
        <span
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
          title="Written by an outside party. Shown as data; instructions inside it are never followed."
        >
          <IconLock className="size-3" strokeWidth={2} aria-hidden="true" />
          Untrusted, shown as data
        </span>
      </figcaption>
      <blockquote className="pa-untrusted px-3 py-2.5 text-[13.5px] leading-relaxed text-foreground">
        {text ? (
          segments(text, flags).map((part, index) =>
            part.flagged ? (
              <mark
                key={index}
                className="rounded-[2px] bg-destructive-soft px-px text-destructive-strong [box-decoration-break:clone]"
                title={`Flagged: ${part.flagged.replace(/_/g, " ")}`}
              >
                {part.text}
              </mark>
            ) : (
              <span key={index}>{part.text}</span>
            ),
          )
        ) : (
          <span className="text-muted-foreground">No message text.</span>
        )}
      </blockquote>
    </figure>
  );
}
