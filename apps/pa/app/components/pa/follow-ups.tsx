// The lead's follow-ups (D101): each step of its cadence with its day and
// purpose. The next one the agent wrote opens for review: edit it, send it
// from the owner's Gmail as a reply in the thread, or skip it.
import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import type { FollowUpView, FollowUpsView } from "@shared/pa-views";
import {
  IconCheck,
  IconCircleDashed,
  IconLoader2,
  IconPlayerSkipForward,
  IconSend,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

const OPEN = new Set(["scheduled", "drafted", "needs_edit"]);

function StatusLabel({ item }: { item: FollowUpView }) {
  const base =
    "inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-[5px] px-1.5 text-[11.5px] font-medium";
  switch (item.status) {
    case "sent":
      return (
        <span className={cn(base, "bg-primary-soft text-primary")}>
          <IconCheck className="size-3.5" aria-hidden="true" />
          Sent {item.sentAt ? day(item.sentAt) : ""}
        </span>
      );
    case "stopped":
      return (
        <span
          className={cn(
            base,
            "text-muted-foreground ring-1 ring-inset ring-border",
          )}
          title={item.stopReason ?? undefined}
        >
          {/^Skipped/.test(item.stopReason ?? "") ? "Skipped" : "Stopped"}
        </span>
      );
    case "drafted":
      return (
        <span className={cn(base, "bg-primary-soft text-primary")}>
          Ready to review
        </span>
      );
    case "needs_edit":
      return (
        <span className={cn(base, "bg-warning-soft text-warning-foreground")}>
          Fix before sending
        </span>
      );
    default:
      return (
        <span className={cn(base, "text-muted-foreground")}>
          {day(item.dueAt)}
        </span>
      );
  }
}

export function FollowUpsCard({
  followUps,
  editable,
  onChanged,
}: {
  followUps: FollowUpsView;
  /** People with a PA role can edit, skip, and stop. */
  editable: boolean;
  onChanged: () => void;
}) {
  const items = followUps.items;
  const current = items.find((item) => OPEN.has(item.status)) ?? null;
  const stopAll = useActionMutation("skip-follow-up");
  const stoppedAll = items.every((item) => !OPEN.has(item.status));
  const stopReason = items.find(
    (item) =>
      item.status === "stopped" && !/^Skipped/.test(item.stopReason ?? ""),
  )?.stopReason;
  return (
    <section
      aria-label="Follow-ups"
      className="rounded-lg border border-border bg-card shadow-xs"
    >
      <header className="flex min-h-11 items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h2 className="text-[13px] font-semibold text-foreground">
          Follow-ups
        </h2>
        {editable && current ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-[12px] text-muted-foreground"
            disabled={stopAll.isPending}
            onClick={() =>
              stopAll.mutate(
                { followUpId: current.id, all: true },
                {
                  onSuccess: () => {
                    toast.success("Stopped the follow-ups on this lead.");
                    onChanged();
                  },
                  onError: (error) => toast.error(actionErrorMessage(error)),
                },
              )
            }
          >
            <IconX className="size-3.5" aria-hidden="true" />
            Stop follow-ups
          </Button>
        ) : stoppedAll && stopReason ? (
          <span className="text-[12px] text-muted-foreground">
            {stopReason}
          </span>
        ) : null}
      </header>
      {followUps.pausedUntil ? (
        <p className="border-b border-border bg-muted/40 px-4 py-2 text-[12.5px] text-muted-foreground">
          Out of office. Follow-ups wait until {day(followUps.pausedUntil)}.
        </p>
      ) : null}
      {followUps.reply ? (
        <ReplyLabel
          reply={followUps.reply}
          engagementId={engagementIdOf(followUps)}
          editable={editable}
          onChanged={onChanged}
        />
      ) : null}
      <ol className="divide-y divide-border">
        {items.map((item) => (
          <li key={item.id}>
            <div className="flex items-start gap-3 px-4 py-2.5">
              <span
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  item.status === "sent"
                    ? "bg-primary text-primary-foreground"
                    : item === current
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {item.status === "sent" ? (
                  <IconCheck className="size-3" aria-hidden="true" />
                ) : item.status === "stopped" ? (
                  <IconCircleDashed className="size-3" aria-hidden="true" />
                ) : (
                  item.step
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-foreground">
                  Day {item.day}
                </p>
                <p className="line-clamp-2 text-[12.5px] leading-snug text-muted-foreground">
                  {item.purpose}
                </p>
              </div>
              <StatusLabel item={item} />
            </div>
            {item === current &&
            (item.status === "drafted" || item.status === "needs_edit") ? (
              <FollowUpEditor
                item={item}
                followUps={followUps}
                editable={editable}
                onChanged={onChanged}
              />
            ) : item === current && item.status === "scheduled" ? (
              <p className="px-4 pb-3 pl-12 text-[12px] text-muted-foreground">
                The agent writes it the day before it is due.
              </p>
            ) : item.status === "sent" && item.body ? (
              <details className="px-4 pb-2.5 pl-12">
                <summary className="cursor-pointer text-[12px] text-muted-foreground">
                  What was sent
                </summary>
                <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
                  {item.body}
                </p>
              </details>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function FollowUpEditor({
  item,
  followUps,
  editable,
  onChanged,
}: {
  item: FollowUpView;
  followUps: FollowUpsView;
  editable: boolean;
  onChanged: () => void;
}) {
  const initial = item.body ?? "";
  const [body, setBody] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setBody(initial), [initial]);
  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 6000);
    return () => window.clearTimeout(timer);
  }, [confirming]);
  const save = useActionMutation("edit-follow-up");
  const send = useActionMutation("send-follow-up");
  const skip = useActionMutation("skip-follow-up");
  const dirty = body !== initial;
  const locked = !followUps.canSend
    ? followUps.ownerEmail
      ? `Only ${followUps.ownerEmail}, the lead's owner, can send this.`
      : "No owner yet, so no one can send this."
    : item.status !== "drafted"
      ? "Fix the message rule problems first."
      : null;
  const notYet = new Date(item.dueAt).getTime() > Date.now();
  const done = (message: string) => () => {
    toast.success(message);
    onChanged();
  };
  const failed = (error: unknown) => {
    toast.error(actionErrorMessage(error));
    onChanged();
  };
  return (
    <div className="mx-4 mb-3 ml-12 rounded-md border border-border">
      <p className="truncate border-b border-border px-3 py-1.5 text-[12px] text-muted-foreground">
        {item.subject ?? "Reply in the thread"}
        {item.cc ? `  ·  Cc ${item.cc}` : ""}
      </p>
      <textarea
        aria-label={`Follow-up ${item.step}`}
        value={body}
        readOnly={!editable}
        onChange={(event) => setBody(event.target.value)}
        className="block min-h-32 w-full resize-none bg-transparent px-3 py-2 text-[13.5px] leading-[1.6] text-foreground outline-none [field-sizing:content]"
      />
      {item.problems.length > 0 && !dirty ? (
        <ul className="mx-3 mb-2 list-disc space-y-0.5 rounded-md bg-warning-soft py-2 pl-7 pr-3 text-[12.5px] text-warning-foreground">
          {item.problems.map((problem) => (
            <li key={`${problem.code}-${problem.message}`}>
              {problem.message}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
        {dirty ? (
          <>
            <Button
              type="button"
              size="sm"
              disabled={save.isPending || !body.trim()}
              onClick={() =>
                save.mutate(
                  { followUpId: item.id, body: body.trim() },
                  {
                    onSuccess: (result) => {
                      const problems =
                        (result as { problems?: unknown[] }).problems ?? [];
                      if (problems.length > 0)
                        toast.warning(
                          "Saved. It breaks a message rule; fix it before it goes out.",
                        );
                      else toast.success("Saved your edits.");
                      onChanged();
                    },
                    onError: failed,
                  },
                )
              }
            >
              <IconCheck className="size-4" aria-hidden="true" />
              Save changes
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setBody(initial)}
            >
              Discard
            </Button>
          </>
        ) : (
          <>
            <Locked reason={locked}>
              <Button
                type="button"
                size="sm"
                disabled={Boolean(locked) || send.isPending}
                onClick={() =>
                  confirming
                    ? send.mutate(
                        { followUpId: item.id },
                        {
                          onSuccess: done(
                            "Sent from your Gmail, in the thread.",
                          ),
                          onError: failed,
                        },
                      )
                    : setConfirming(true)
                }
              >
                {send.isPending ? (
                  <IconLoader2
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <IconSend className="size-4" aria-hidden="true" />
                )}
                {confirming
                  ? "Click again to send"
                  : notYet
                    ? "Send now"
                    : "Approve and send"}
              </Button>
            </Locked>
            {editable ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={skip.isPending}
                onClick={() =>
                  skip.mutate(
                    { followUpId: item.id },
                    {
                      onSuccess: done("Skipped this follow-up."),
                      onError: failed,
                    },
                  )
                }
              >
                <IconPlayerSkipForward className="size-4" aria-hidden="true" />
                Skip
              </Button>
            ) : null}
            <span className="ml-auto text-[12px] text-muted-foreground">
              {followUps.leadZone
                ? `${localTime(followUps.leadZone)} for them · `
                : ""}
              {notYet ? `Due ${day(item.dueAt)}` : "Due now"}
              {item.wordCount !== null ? ` · ${item.wordCount} words` : ""}
            </span>
          </>
        )}
      </div>
      {item.reasoning ? (
        <details className="border-t border-border px-3 py-1.5">
          <summary className="cursor-pointer text-[12px] text-muted-foreground">
            Why it reads this way
          </summary>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
            {item.reasoning}
          </p>
        </details>
      ) : null}
    </div>
  );
}

function Locked({
  reason,
  children,
}: {
  reason: string | null;
  children: ReactNode;
}) {
  if (!reason) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

/** The lead's wall clock now, so a send at 9 PM their time is visible. */
function localTime(zone: string) {
  try {
    return new Date().toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: zone,
    });
  } catch {
    return "";
  }
}

const engagementIdOf = (followUps: FollowUpsView) => followUps.engagementId;

const LABELS: Array<{ value: string; label: string }> = [
  { value: "interested", label: "Interested" },
  { value: "referral", label: "Referred someone" },
  { value: "not_interested", label: "Not interested" },
  { value: "unsubscribe", label: "Asked to stop" },
  { value: "out_of_office", label: "Out of office (resume)" },
  { value: "other", label: "Other" },
];

/** The reply that stopped the cadence, its label, and a way to correct it. */
function ReplyLabel({
  reply,
  engagementId,
  editable,
  onChanged,
}: {
  reply: NonNullable<FollowUpsView["reply"]>;
  engagementId: string;
  editable: boolean;
  onChanged: () => void;
}) {
  const label = useActionMutation("label-reply");
  return (
    <div className="border-b border-border px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-medium text-foreground">
          They replied
        </span>
        {editable ? (
          <select
            aria-label="Reply label"
            className="h-7 rounded-md border border-input bg-background px-1.5 text-[12.5px]"
            value={reply.label ?? ""}
            disabled={label.isPending}
            onChange={(event) =>
              label.mutate(
                {
                  engagementId,
                  emailId: reply.emailId,
                  label: event.target.value as never,
                },
                {
                  onSuccess: () => {
                    toast.success(
                      event.target.value === "out_of_office"
                        ? "Marked out of office. The follow-ups resume after they are back."
                        : "Label saved.",
                    );
                    onChanged();
                  },
                  onError: (error) => toast.error(actionErrorMessage(error)),
                },
              )
            }
          >
            <option value="" disabled>
              {reply.label ? "" : "Labeling..."}
            </option>
            {LABELS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        ) : reply.label ? (
          <span className="text-[12.5px] text-muted-foreground">
            {LABELS.find((item) => item.value === reply.label)?.label}
          </span>
        ) : null}
      </div>
      {reply.summary || reply.preview ? (
        <p className="pa-untrusted mt-1 line-clamp-2 text-[12.5px] text-muted-foreground">
          {reply.summary ?? reply.preview}
        </p>
      ) : null}
    </div>
  );
}
