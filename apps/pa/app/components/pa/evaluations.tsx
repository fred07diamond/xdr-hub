import type { EvaluationView, OpenItemView } from "@shared/pa-views";
import {
  IconCircle,
  IconCircleCheckFilled,
  IconCircleDashed,
} from "@tabler/icons-react";

import { humanize } from "@/lib/format";
import { cn } from "@/lib/utils";

import { CitationChips } from "./badges";

export function EvaluationList({ items }: { items: EvaluationView[] }) {
  if (items.length === 0) return null;
  return (
    <ol className="space-y-2">
      {items.map((item) => {
        const Icon =
          item.matched === true
            ? IconCircleCheckFilled
            : item.matched === false
              ? IconCircle
              : IconCircleDashed;
        return (
          <li key={item.name} className="flex gap-2.5">
            <Icon
              className={cn(
                "mt-px size-4 shrink-0",
                item.matched === true
                  ? "text-foreground"
                  : "text-muted-foreground/60",
              )}
              strokeWidth={1.75}
              aria-label={
                item.matched === true
                  ? "Matched"
                  : item.matched === false
                    ? "Did not match"
                    : "Not evaluated"
              }
            />
            <div className="min-w-0">
              <p
                className={cn(
                  "text-[13px]",
                  item.matched === true
                    ? "font-medium text-foreground"
                    : "text-foreground/85",
                )}
              >
                {humanize(item.name)}
              </p>
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                {item.detail}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function OpenItems({ items }: { items: OpenItemView[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <h4 className="text-[12px] font-medium text-muted-foreground">
        Open items <span className="font-normal">(recorded, not guessed)</span>
      </h4>
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.code}
            className="rounded-md border border-dashed border-foreground/25 px-3 py-2"
          >
            <p className="text-[12.5px] leading-relaxed text-foreground">
              {item.detail}
            </p>
            {item.entry ? (
              <CitationChips entries={[item.entry]} className="mt-1.5" />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
