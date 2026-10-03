// Enroll a lead in a sequence (D105): after reviewing the lead, its owner
// picks a sequence (the one suggested for the lead's route comes first),
// sees every step with its date, and for an editable sequence reviews and
// edits each email filled in for this lead. Enrolling approves them.
import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import type { SequenceKind } from "@shared/sequences";
import { IconCheck, IconLoader2, IconTimelineEvent } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { KindChip, ThreadChip } from "@/components/pa/sequence-ui";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface PreviewStep {
  stepId: string;
  index: number;
  day: number;
  dueAt: string;
  thread: "reply" | "new";
  cc: string | null;
  purpose: string;
  subject: string | null;
  body: string | null;
  problems: Array<{ code: string; message: string }>;
}
interface Preview {
  routeLabel: string;
  sequences: Array<{
    id: string;
    name: string;
    kind: SequenceKind;
    description: string;
    steps: number;
    days: number;
    recommended: boolean;
  }>;
  sequenceId: string | null;
  kind: SequenceKind | null;
  steps: PreviewStep[];
  blocker: string | null;
}

const date = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

/** The lead page's Sequence card: current sequence, or Enroll. */
export function SequenceCard({
  engagementId,
  current,
  firstTouchSent,
  onChanged,
}: {
  engagementId: string;
  /** The sequence the lead is in now, if any. */
  current: { name: string; active: boolean } | null;
  firstTouchSent: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section
      aria-label="Sequence"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
    >
      <IconTimelineEvent
        className="size-4 text-muted-foreground"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-foreground">
          {current?.active ? current.name : "Not in a sequence"}
        </p>
        <p className="text-[12px] text-muted-foreground">
          {current?.active
            ? "Follow-ups below. A reply, meeting, or stage change unenrolls them."
            : firstTouchSent
              ? "Review the lead, then pick the follow-ups it gets."
              : "Send the first touch first; the sequence follows it."}
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant={current?.active ? "outline" : "default"}
        disabled={!firstTouchSent}
        onClick={() => setOpen(true)}
      >
        {current?.active ? "Change sequence" : "Enroll in a sequence"}
      </Button>
      <EnrollSheet
        open={open}
        engagementId={engagementId}
        onClose={() => setOpen(false)}
        onEnrolled={() => {
          setOpen(false);
          onChanged();
        }}
      />
    </section>
  );
}

function EnrollSheet({
  open,
  engagementId,
  onClose,
  onEnrolled,
}: {
  open: boolean;
  engagementId: string;
  onClose: () => void;
  onEnrolled: () => void;
}) {
  const preview = useActionMutation("preview-enrollment");
  const enroll = useActionMutation("enroll-lead");
  const [data, setData] = useState<Preview | null>(null);
  const [edits, setEdits] = useState<
    Record<string, { subject?: string; body?: string }>
  >({});

  const load = useCallback(
    (sequenceId?: string, withEdits = {}) =>
      preview.mutate(
        { engagementId, sequenceId, edits: withEdits },
        {
          onSuccess: (result) => setData(result as Preview),
          onError: (error) => toast.error(actionErrorMessage(error)),
        },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engagementId],
  );

  useEffect(() => {
    if (open) {
      setEdits({});
      load();
    }
  }, [open, load]);

  const pick = (sequenceId: string) => {
    setEdits({});
    load(sequenceId);
  };
  const edit = (stepId: string, patch: { subject?: string; body?: string }) =>
    setEdits((current) => ({
      ...current,
      [stepId]: { ...current[stepId], ...patch },
    }));
  const problems = data?.steps.some((step) => step.problems.length > 0);
  const template = data?.kind === "template";

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Enroll in a sequence</SheetTitle>
          <SheetDescription>
            {data
              ? `Route: ${data.routeLabel}. Days count from the first touch, in the lead's business hours.`
              : "Loading the sequences..."}
          </SheetDescription>
        </SheetHeader>
        {!data ? (
          <div className="m-4 h-64 animate-pulse rounded-lg bg-muted" />
        ) : (
          <div className="grid gap-4 px-4 pb-4">
            <ul className="grid gap-2" aria-label="Sequences">
              {data.sequences.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => pick(item.id)}
                    className={cn(
                      "grid w-full gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      item.id === data.sequenceId
                        ? "border-primary bg-primary-soft/40"
                        : "border-border hover:bg-muted/40",
                    )}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold text-foreground">
                        {item.name}
                      </span>
                      <KindChip kind={item.kind} />
                      {item.recommended ? (
                        <span className="text-[11.5px] font-medium text-primary">
                          Suggested for this lead
                        </span>
                      ) : null}
                    </span>
                    <span className="text-[12px] text-muted-foreground">
                      {item.steps} {item.steps === 1 ? "email" : "emails"} over{" "}
                      {item.days} days
                      {item.description ? `. ${item.description}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <ol className="grid gap-3" aria-label="Steps">
              {data.steps.map((step) => (
                <li
                  key={`${data.sequenceId}-${step.stepId}`}
                  className="rounded-lg border border-border"
                >
                  <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                    <span className="text-[12.5px] font-semibold text-foreground">
                      {step.index}. Day {step.day} · {date(step.dueAt)}
                    </span>
                    <ThreadChip thread={step.thread} />
                    {step.cc ? (
                      <span className="text-[11.5px] text-muted-foreground">
                        Cc {step.cc}
                      </span>
                    ) : null}
                  </div>
                  {template ? (
                    <div className="grid gap-1.5 p-3">
                      {step.thread === "new" ? (
                        <input
                          aria-label={`Subject of email ${step.index}`}
                          className="rounded-md border border-input bg-background px-2.5 py-1.5 text-[13px] font-medium"
                          value={
                            edits[step.stepId]?.subject ?? step.subject ?? ""
                          }
                          onChange={(event) =>
                            edit(step.stepId, { subject: event.target.value })
                          }
                        />
                      ) : (
                        <p className="text-[12px] text-muted-foreground">
                          {step.subject}
                        </p>
                      )}
                      <textarea
                        aria-label={`Email ${step.index}`}
                        rows={6}
                        className="rounded-md border border-input bg-background px-2.5 py-1.5 text-[13px] leading-relaxed [field-sizing:content]"
                        value={edits[step.stepId]?.body ?? step.body ?? ""}
                        onChange={(event) =>
                          edit(step.stepId, { body: event.target.value })
                        }
                      />
                      {step.problems.length > 0 ? (
                        <ul className="list-disc rounded-md bg-warning-soft py-1.5 pl-6 pr-2 text-[12px] text-warning-foreground">
                          {step.problems.map((problem) => (
                            <li key={`${problem.code}-${problem.message}`}>
                              {problem.message}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : (
                    <p className="px-3 py-2.5 text-[13px] text-foreground">
                      <span className="text-muted-foreground">
                        The agent writes:{" "}
                      </span>
                      {step.purpose}
                    </p>
                  )}
                </li>
              ))}
            </ol>

            <div className="sticky bottom-0 grid gap-2 border-t border-border bg-background py-3">
              {data.blocker ? (
                <p className="text-[12.5px] text-warning-foreground">
                  {data.blocker}
                </p>
              ) : (
                <p className="text-[12px] text-muted-foreground">
                  {template
                    ? "Enrolling approves these emails. Each sends on its day from your Gmail unless they reply, book, or move on first."
                    : "The agent writes each email the day before it is due; you approve each one on the lead or in the send queue."}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {template ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={preview.isPending}
                    onClick={() => load(data.sequenceId ?? undefined, edits)}
                  >
                    Check my edits
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    Boolean(data.blocker) ||
                    !data.sequenceId ||
                    enroll.isPending ||
                    (problems && Object.keys(edits).length === 0)
                  }
                  onClick={() =>
                    enroll.mutate(
                      {
                        engagementId,
                        sequenceId: data.sequenceId ?? "",
                        edits,
                      },
                      {
                        onSuccess: () => {
                          toast.success("Enrolled.");
                          onEnrolled();
                        },
                        onError: (error) => {
                          toast.error(actionErrorMessage(error));
                          load(data.sequenceId ?? undefined, edits);
                        },
                      },
                    )
                  }
                >
                  {enroll.isPending ? (
                    <IconLoader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <IconCheck className="size-4" aria-hidden="true" />
                  )}
                  {template ? "Approve and enroll" : "Enroll"}
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <Link to={`/sequencing/${data.sequenceId ?? ""}`}>
                    Edit this sequence
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
