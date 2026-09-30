import type { AnswerView } from "@shared/pa-views";

import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

function SourceText({ answer }: { answer: AnswerView }) {
  if (!answer.source)
    return <span className="text-muted-foreground">No source</span>;
  return (
    <span
      className="block min-w-0"
      title={`${answer.source.kind}: ${answer.source.ref}`}
    >
      <span className="block capitalize text-foreground/85">
        {answer.source.kind}
      </span>
      <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
        {answer.source.ref}
      </span>
    </span>
  );
}

export function ScorecardTable({ answers }: { answers: AnswerView[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_minmax(0,1fr)_76px_72px] gap-3 border-b border-border bg-muted/50 px-3 py-2 text-[11.5px] font-medium text-muted-foreground @2xl:grid">
        <span>Question</span>
        <span>Answer</span>
        <span>Source</span>
        <span>As of</span>
        <span>Confidence</span>
      </div>
      <ul className="divide-y divide-border">
        {answers.map((answer) => (
          <li
            key={answer.question}
            className="grid grid-cols-1 gap-1 px-3 py-2.5 text-[12.5px] @2xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_minmax(0,1fr)_76px_72px] @2xl:gap-3"
          >
            <span className="flex min-w-0 gap-2">
              <span className="w-7 shrink-0 text-[11.5px] font-medium tabular-nums leading-[18px] text-muted-foreground">
                {answer.question}
              </span>
              <span className="font-medium text-foreground">
                {answer.label}
              </span>
            </span>
            <span
              className={cn(
                "min-w-0 pl-9 @2xl:pl-0",
                answer.known ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {answer.known ? null : (
                <span className="mr-1.5 inline-flex h-[18px] items-center rounded-[4px] border border-dashed border-foreground/30 px-1 text-[10.5px] font-medium text-muted-foreground">
                  Unknown
                </span>
              )}
              {answer.known
                ? answer.answer
                : answer.answer.replace(/^unknown:?\s*/i, "")}
              {answer.conflicts.length > 0 ? (
                <span className="mt-1 block text-[11.5px] text-warning-foreground">
                  Conflicts:{" "}
                  {answer.conflicts
                    .map((item) => `${item.source.kind} says ${item.value}`)
                    .join("; ")}
                </span>
              ) : null}
            </span>
            <span className="min-w-0 pl-9 text-[12px] @2xl:pl-0">
              <SourceText answer={answer} />
            </span>
            <span className="pl-9 text-[12px] text-muted-foreground @2xl:pl-0">
              {answer.asOf ? formatDate(answer.asOf) : "None"}
            </span>
            <span className="pl-9 text-[12px] capitalize text-muted-foreground @2xl:pl-0">
              {answer.confidence ?? "None"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
