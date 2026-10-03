// The send queue (D103): step through the follow-ups that are due, one at a
// time, with the lead's context beside the email. Edit, send, or skip, and
// the next one opens. Keys: Ctrl or Cmd + Enter sends, Alt + arrows move.
import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import {
  IconArrowLeft,
  IconChevronLeft,
  IconChevronRight,
  IconConfetti,
  IconLoader2,
  IconPlayerSkipForward,
  IconSend,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { EmptyState, ErrorState } from "@/components/pa/states";
import { Button } from "@/components/ui/button";
import { APP_TITLE } from "@/lib/app-config";
import { cn } from "@/lib/utils";

export function meta() {
  return [{ title: `Send queue - ${APP_TITLE}` }];
}

interface Row {
  id: string;
  engagementId: string;
  lead: string;
  mine: boolean;
  owner: string | null;
  step: number;
  of: number;
  status: "scheduled" | "drafted" | "needs_edit";
}

interface Detail {
  followUp: {
    id: string;
    step: number;
    of: number;
    day: number;
    purpose: string;
    dueAt: string;
    cc: string | null;
    body: string | null;
    problems: Array<{ code: string; message: string }>;
    wordCount: number | null;
    reasoning: string | null;
  };
  lead: { name: string | null; email: string | null };
  subject: string;
  firstTouch: { subject: string | null; body: string | null };
  earlierFollowUps: Array<{
    step: number;
    status: string;
    body: string | null;
  }>;
}

export default function SendQueueRoute() {
  const [everyone, setEveryone] = useState(false);
  const list = useActionQuery("list-follow-ups", {});
  const rows = useMemo(() => {
    const due = ((list.data as { due?: Row[] } | undefined)?.due ?? []).filter(
      (row) => row.status !== "scheduled",
    );
    return everyone ? due : due.filter((row) => row.mine);
  }, [list.data, everyone]);
  const [index, setIndex] = useState(0);
  const current = rows[Math.min(index, Math.max(rows.length - 1, 0))] ?? null;

  if (list.isPending)
    return (
      <Frame>
        <div className="h-96 animate-pulse rounded-lg border border-border bg-card" />
      </Frame>
    );
  if (list.error)
    return (
      <Frame>
        <ErrorState
          title="Couldn't load the queue"
          error={list.error}
          onRetry={() => void list.refetch()}
        />
      </Frame>
    );

  return (
    <Frame
      toolbar={
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <input
              type="checkbox"
              checked={everyone}
              onChange={(event) => {
                setEveryone(event.target.checked);
                setIndex(0);
              }}
            />
            Everyone's
          </label>
          {rows.length > 0 ? (
            <span className="text-[12.5px] text-muted-foreground">
              {Math.min(index, rows.length - 1) + 1} of {rows.length}
            </span>
          ) : null}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label="Previous"
            disabled={index <= 0}
            onClick={() => setIndex((value) => Math.max(0, value - 1))}
          >
            <IconChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label="Next"
            disabled={index >= rows.length - 1}
            onClick={() =>
              setIndex((value) => Math.min(rows.length - 1, value + 1))
            }
          >
            <IconChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      }
    >
      {!current ? (
        <EmptyState icon={IconConfetti} title="All caught up">
          No follow-ups ready to send{everyone ? "" : " on your leads"}. New
          ones show up here the day they are due.
        </EmptyState>
      ) : (
        <QueueItem
          key={current.id}
          row={current}
          onPrev={() => setIndex((value) => Math.max(0, value - 1))}
          onNext={() =>
            setIndex((value) => Math.min(rows.length - 1, value + 1))
          }
          onDone={() => void list.refetch()}
        />
      )}
    </Frame>
  );
}

function Frame({
  toolbar,
  children,
}: {
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto grid w-full max-w-[1100px] gap-4 px-3 py-4 sm:px-4 md:px-6 md:py-5">
      <header className="flex flex-wrap items-center gap-3">
        <Button asChild size="sm" variant="ghost" className="-ml-2">
          <Link to="/sequencing">
            <IconArrowLeft className="size-4" aria-hidden="true" />
            Sequencing
          </Link>
        </Button>
        <h1 className="flex-1 text-[18px] font-semibold text-foreground">
          Send queue
        </h1>
        {toolbar}
      </header>
      {children}
    </div>
  );
}

function QueueItem({
  row,
  onPrev,
  onNext,
  onDone,
}: {
  row: Row;
  onPrev: () => void;
  onNext: () => void;
  onDone: () => void;
}) {
  const detail = useActionQuery("get-follow-up", { followUpId: row.id });
  const data = detail.data as Detail | undefined;
  const initial = data?.followUp.body ?? "";
  const [body, setBody] = useState(initial);
  useEffect(() => setBody(initial), [initial]);
  const edit = useActionMutation("edit-follow-up");
  const send = useActionMutation("send-follow-up");
  const skip = useActionMutation("skip-follow-up");
  const busy = edit.isPending || send.isPending || skip.isPending;
  const dirty = body.trim() !== initial.trim();
  const problems = data?.followUp.problems ?? [];

  const sendNow = useCallback(async () => {
    if (!row.mine || busy || !data) return;
    try {
      if (dirty) {
        const saved = (await edit.mutateAsync({
          followUpId: row.id,
          body: body.trim(),
        })) as { status: string; problems: unknown[] };
        if (saved.status !== "drafted") {
          toast.warning("Saved, but it breaks a message rule. Fix it first.");
          void detail.refetch();
          return;
        }
      }
      await send.mutateAsync({ followUpId: row.id });
      toast.success(`Sent to ${data.lead.name ?? data.lead.email}.`);
      onDone();
    } catch (error) {
      toast.error(actionErrorMessage(error));
      onDone();
    }
  }, [row, busy, data, dirty, body, edit, send, detail, onDone]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void sendNow();
      }
      if (event.altKey && event.key === "ArrowRight") onNext();
      if (event.altKey && event.key === "ArrowLeft") onPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sendNow, onNext, onPrev]);

  if (detail.isPending)
    return (
      <div className="h-96 animate-pulse rounded-lg border border-border bg-card" />
    );
  if (!data)
    return (
      <ErrorState
        title="Couldn't load this follow-up"
        error={detail.error}
        onRetry={() => void detail.refetch()}
      />
    );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <aside className="grid content-start gap-3 rounded-lg border border-border bg-card p-4">
        <div>
          <Link
            to={`/inbound/${row.engagementId}`}
            className="text-[15px] font-semibold text-foreground hover:underline"
          >
            {data.lead.name ?? data.lead.email}
          </Link>
          <p className="font-mono text-[12px] text-muted-foreground">
            {data.lead.email}
          </p>
        </div>
        <p className="text-[12.5px] text-muted-foreground">
          Follow-up {data.followUp.step} of {data.followUp.of}, day{" "}
          {data.followUp.day}:{" "}
          <span className="text-foreground">{data.followUp.purpose}</span>
        </p>
        <details open>
          <summary className="cursor-pointer text-[12.5px] font-medium text-foreground">
            First touch
          </summary>
          <p className="pa-untrusted mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">
            {data.firstTouch.body ?? "Not available."}
          </p>
        </details>
        {data.earlierFollowUps.length > 0 ? (
          <details>
            <summary className="cursor-pointer text-[12.5px] font-medium text-foreground">
              Earlier follow-ups ({data.earlierFollowUps.length})
            </summary>
            {data.earlierFollowUps.map((item) => (
              <p
                key={item.step}
                className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground"
              >
                {item.step}. {item.body}
              </p>
            ))}
          </details>
        ) : null}
        {data.followUp.reasoning ? (
          <p className="text-[12px] text-muted-foreground">
            Why: {data.followUp.reasoning}
          </p>
        ) : null}
      </aside>

      <section className="flex min-w-0 flex-col rounded-lg border border-border bg-card">
        <p className="truncate border-b border-border px-4 py-2 text-[12.5px] text-muted-foreground">
          {data.subject}
          {data.followUp.cc ? `  ·  Cc ${data.followUp.cc}` : ""}
        </p>
        <textarea
          aria-label="Follow-up"
          value={body}
          readOnly={!row.mine}
          onChange={(event) => setBody(event.target.value)}
          className="min-h-64 flex-1 resize-none bg-transparent px-4 py-3 text-[14px] leading-[1.6] text-foreground outline-none [field-sizing:content]"
        />
        {problems.length > 0 && !dirty ? (
          <ul className="mx-4 mb-3 list-disc space-y-0.5 rounded-md bg-warning-soft py-2 pl-7 pr-3 text-[12.5px] text-warning-foreground">
            {problems.map((problem) => (
              <li key={`${problem.code}-${problem.message}`}>
                {problem.message}
              </li>
            ))}
          </ul>
        ) : null}
        <footer className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          <Button
            type="button"
            size="sm"
            disabled={!row.mine || busy}
            onClick={() => void sendNow()}
            title={
              row.mine
                ? "Ctrl or Cmd + Enter"
                : `Only ${row.owner} can send this`
            }
          >
            {send.isPending || edit.isPending ? (
              <IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <IconSend className="size-4" aria-hidden="true" />
            )}
            {dirty ? "Save and send" : "Approve and send"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              skip.mutate(
                { followUpId: row.id },
                {
                  onSuccess: () => {
                    toast.success("Skipped.");
                    onDone();
                  },
                  onError: (error) => toast.error(actionErrorMessage(error)),
                },
              )
            }
          >
            <IconPlayerSkipForward className="size-4" aria-hidden="true" />
            Skip
          </Button>
          <span
            className={cn(
              "ml-auto text-[12px] text-muted-foreground",
              !row.mine && "text-warning-foreground",
            )}
          >
            {row.mine
              ? "Ctrl or Cmd + Enter to send · Alt + arrows to move"
              : `Only ${row.owner ?? "the owner"} can send this`}
          </span>
        </footer>
      </section>
    </div>
  );
}
