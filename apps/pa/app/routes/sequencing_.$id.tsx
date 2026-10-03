// The sequence builder (D105), modeled on HubSpot's: a summary bar, then the
// steps as cards on a timeline with the delay between them, each with its
// email (or, for an agent-written sequence, what the agent writes) and its
// results. Any PA edits; Save applies to leads enrolled after it.
import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { CADENCE_ROUTES } from "@shared/cadence";
import {
  orderedSteps,
  TEMPLATE_TOKENS,
  UNENROLL_CRITERIA,
  type SequenceKind,
  type SequenceStep,
} from "@shared/sequences";
import {
  IconArchive,
  IconArrowLeft,
  IconCheck,
  IconChevronDown,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import {
  DelayPill,
  KindChip,
  ThreadChip,
  TokenText,
} from "@/components/pa/sequence-ui";
import { ErrorState } from "@/components/pa/states";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { APP_TITLE } from "@/lib/app-config";
import { cn } from "@/lib/utils";

export function meta() {
  return [{ title: `Sequence - ${APP_TITLE}` }];
}

type Step = SequenceStep & {
  stats?: { sent: number; replies: number; meetings: number };
};
interface Sequence {
  id: string;
  name: string;
  kind: SequenceKind;
  description: string;
  recommendedFor: string[];
  archived: boolean;
  version: number;
  updatedBy: string;
  updatedAt: string;
  steps: Step[];
  enrolled: number;
  active: number;
}

const input =
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-[13px] text-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

let counter = 0;
const stepId = () => `s${Date.now().toString(36)}${(counter += 1)}`;

function emptySequence(kind: SequenceKind): Sequence {
  return {
    id: "",
    name: "",
    kind,
    description: "",
    recommendedFor: [],
    archived: false,
    version: 0,
    updatedBy: "",
    updatedAt: "",
    enrolled: 0,
    active: 0,
    steps: [
      {
        id: stepId(),
        day: 2,
        thread: "reply",
        cc_ae: true,
        purpose: "",
        subject: "",
        body:
          kind === "template"
            ? "Hi {{first_name}},\n\n\n\n{{owner_first_name}}"
            : "",
      },
    ],
  };
}

export default function SequenceBuilderRoute() {
  const { id = "new" } = useParams();
  const isNew = id === "new" || id === "new-template";
  const navigate = useNavigate();
  const list = useActionQuery(
    "list-sequences",
    { includeArchived: true },
    { enabled: !isNew },
  );
  const loaded = useMemo(
    () =>
      (
        (list.data as { sequences?: Sequence[] } | undefined)?.sequences ?? []
      ).find((item) => item.id === id) ?? null,
    [list.data, id],
  );
  const [draft, setDraft] = useState<Sequence | null>(
    isNew
      ? emptySequence(id === "new-template" ? "template" : "dynamic")
      : null,
  );
  useEffect(() => {
    if (loaded) setDraft(structuredClone(loaded));
  }, [loaded]);
  const [editing, setEditing] = useState<string | null>(
    isNew ? (draft?.steps[0]?.id ?? null) : null,
  );
  const save = useActionMutation("save-sequence");
  const archive = useActionMutation("archive-sequence");

  if (!isNew && list.isPending)
    return (
      <Shell>
        <div className="h-96 animate-pulse rounded-lg border border-border bg-card" />
      </Shell>
    );
  if (!draft)
    return (
      <Shell>
        <ErrorState
          title="Couldn't find this sequence"
          error={list.error}
          onRetry={() => void list.refetch()}
        />
      </Shell>
    );

  const steps = orderedSteps(draft.steps);
  const dirty =
    isNew ||
    JSON.stringify(stripStats(draft)) !== JSON.stringify(stripStats(loaded));
  const set = (patch: Partial<Sequence>) => setDraft({ ...draft, ...patch });
  const setStep = (sid: string, patch: Partial<Step>) =>
    set({
      steps: draft.steps.map((step) =>
        step.id === sid ? { ...step, ...patch } : step,
      ),
    });
  const addAfter = (day: number) => {
    const step: Step = {
      id: stepId(),
      day: Math.min(60, day + 2),
      thread: "reply",
      cc_ae: true,
      purpose: "",
      subject: "",
      body:
        draft.kind === "template"
          ? "Hi {{first_name}},\n\n\n\n{{owner_first_name}}"
          : "",
    };
    set({ steps: [...draft.steps, step] });
    setEditing(step.id);
  };
  const totalDays = steps.length ? steps[steps.length - 1].day : 0;

  const onSave = () =>
    save.mutate(
      {
        ...(isNew ? {} : { id: draft.id, version: draft.version }),
        sequence: {
          name: draft.name,
          kind: draft.kind,
          description: draft.description,
          recommendedFor: draft.recommendedFor,
          steps: steps.map(({ stats: _stats, ...step }) => step),
        },
      },
      {
        onSuccess: (result) => {
          toast.success(
            "Sequence saved. It applies to leads enrolled from now on.",
          );
          setEditing(null);
          if (isNew)
            navigate(`/sequencing/${(result as { id: string }).id}`, {
              replace: true,
            });
          else void list.refetch();
        },
        onError: (error) => toast.error(actionErrorMessage(error)),
      },
    );

  return (
    <Shell>
      <header className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="Sequence name"
            placeholder="Name this sequence"
            value={draft.name}
            onChange={(event) => set({ name: event.target.value })}
            className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 -mx-1.5 text-[18px] font-semibold text-foreground outline-none hover:border-border focus:border-ring"
          />
          <KindChip kind={draft.kind} />
          {!isNew ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={archive.isPending}
              onClick={() =>
                archive.mutate(
                  { id: draft.id, archived: !draft.archived },
                  {
                    onSuccess: () => {
                      toast.success(
                        draft.archived
                          ? "Restored."
                          : "Archived. Leads in it carry on.",
                      );
                      void list.refetch();
                    },
                    onError: (error) => toast.error(actionErrorMessage(error)),
                  },
                )
              }
            >
              <IconArchive className="size-4" aria-hidden="true" />
              {draft.archived ? "Restore" : "Archive"}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={!dirty || save.isPending || draft.name.trim().length < 2}
            onClick={onSave}
          >
            <IconCheck className="size-4" aria-hidden="true" />
            {isNew ? "Create sequence" : "Save"}
          </Button>
        </div>
        <input
          aria-label="Description"
          placeholder="What this sequence is for"
          value={draft.description}
          onChange={(event) => set({ description: event.target.value })}
          className="rounded-md border border-transparent bg-transparent px-1.5 py-1 -mx-1.5 text-[13px] text-muted-foreground outline-none hover:border-border focus:border-ring"
        />
        <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
          Suggested for:
          {CADENCE_ROUTES.map((route) => {
            const on = draft.recommendedFor.includes(route.route);
            return (
              <button
                key={route.route}
                type="button"
                onClick={() =>
                  set({
                    recommendedFor: on
                      ? draft.recommendedFor.filter(
                          (item) => item !== route.route,
                        )
                      : [...draft.recommendedFor, route.route],
                  })
                }
                className={cn(
                  "rounded-full px-2 py-0.5 text-[12px] ring-1 ring-inset",
                  on
                    ? "bg-primary-soft text-primary ring-primary/30"
                    : "text-muted-foreground ring-border hover:bg-muted",
                )}
              >
                {route.label}
              </button>
            );
          })}
        </div>
      </header>

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
        <Tile label="Total steps" value={String(steps.length)} />
        <Tile label="Days to complete" value={String(totalDays)} />
        <Tile
          label="Written by"
          value={draft.kind === "dynamic" ? "Agent" : "You"}
          hint={
            draft.kind === "dynamic"
              ? "The agent writes each email near its day; the owner approves each one."
              : "Reps review and edit these emails for each lead when enrolling; enrolling approves them and each sends on its day."
          }
        />
        <Tile
          label="Unenroll criteria"
          value={String(UNENROLL_CRITERIA.length)}
          hint={UNENROLL_CRITERIA.join(". ")}
        />
      </section>

      <ol className="grid">
        {steps.map((step, index) => (
          <li key={step.id}>
            {index === 0 ? (
              <DelayPill days={step.day} />
            ) : (
              <DelayPill days={step.day - steps[index - 1].day} />
            )}
            <StepCard
              step={step}
              index={index}
              kind={draft.kind}
              editing={editing === step.id}
              onEdit={() => setEditing(editing === step.id ? null : step.id)}
              onChange={(patch) => setStep(step.id, patch)}
              onRemove={
                steps.length > 1
                  ? () =>
                      set({
                        steps: draft.steps.filter(
                          (item) => item.id !== step.id,
                        ),
                      })
                  : undefined
              }
            />
          </li>
        ))}
      </ol>
      <div className="flex justify-center">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={steps.length >= 10}
          onClick={() => addAfter(totalDays)}
        >
          <IconPlus className="size-4" aria-hidden="true" />
          Add step
        </Button>
      </div>
      {!isNew && draft.updatedBy ? (
        <p className="text-center text-[12px] text-muted-foreground">
          {draft.enrolled} {draft.enrolled === 1 ? "lead" : "leads"} enrolled,{" "}
          {draft.active} active. Last changed by{" "}
          {draft.updatedBy.replace(/^system:seed$/, "PA")} on{" "}
          {new Date(draft.updatedAt).toLocaleDateString()}.
        </p>
      ) : null}
    </Shell>
  );
}

const stripStats = (sequence: Sequence | null) =>
  sequence
    ? {
        ...sequence,
        steps: sequence.steps.map(({ stats: _stats, ...step }) => step),
      }
    : null;

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto grid w-full max-w-[860px] gap-4 px-3 py-4 sm:px-4 md:px-6 md:py-5">
      <Button asChild size="sm" variant="ghost" className="-ml-2 w-fit">
        <Link to="/sequencing">
          <IconArrowLeft className="size-4" aria-hidden="true" />
          Sequencing
        </Link>
      </Button>
      {children}
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  const content = (
    <div className="bg-card px-4 py-3 text-center">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-[22px] font-semibold text-foreground">{value}</p>
    </div>
  );
  if (!hint) return content;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent className="max-w-xs">{hint}</TooltipContent>
    </Tooltip>
  );
}

function StepCard({
  step,
  index,
  kind,
  editing,
  onEdit,
  onChange,
  onRemove,
}: {
  step: Step;
  index: number;
  kind: SequenceKind;
  editing: boolean;
  onEdit: () => void;
  onChange: (patch: Partial<Step>) => void;
  onRemove?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const stats = step.stats;
  return (
    <article className="rounded-xl border border-border bg-card shadow-xs">
      <header className="flex flex-wrap items-center gap-2 px-4 py-3">
        <span className="flex size-6 items-center justify-center rounded-full bg-primary-soft text-[12px] font-semibold text-primary">
          {index + 1}
        </span>
        <h3 className="text-[13.5px] font-semibold text-foreground">
          {kind === "dynamic" ? "Agent-written email" : "Email"} · Day{" "}
          {step.day}
        </h3>
        <ThreadChip thread={step.thread} />
        {step.cc_ae ? (
          <span className="text-[11.5px] text-muted-foreground">
            AE on cc for exceptional leads
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label={editing ? "Done editing" : "Edit step"}
            onClick={onEdit}
          >
            {editing ? (
              <IconCheck className="size-4" aria-hidden="true" />
            ) : (
              <IconPencil className="size-4" aria-hidden="true" />
            )}
          </Button>
          {onRemove ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8"
              aria-label="Remove step"
              onClick={onRemove}
            >
              <IconTrash className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
        </span>
      </header>

      {editing ? (
        <div className="grid gap-3 border-t border-border px-4 py-3">
          <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-muted-foreground">
            <label className="flex items-center gap-1.5">
              Day
              <input
                type="number"
                min={1}
                max={60}
                className={cn(input, "w-16")}
                value={step.day}
                onChange={(event) =>
                  onChange({
                    day: Math.max(1, Number(event.target.value) || 1),
                  })
                }
              />
              after the first touch
            </label>
            <select
              aria-label="How it is sent"
              className={cn(input, "w-auto")}
              value={step.thread}
              onChange={(event) =>
                onChange({ thread: event.target.value as "reply" | "new" })
              }
            >
              <option value="reply">Reply in the same thread</option>
              <option value="new">New email, own subject</option>
            </select>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={step.cc_ae}
                onChange={(event) => onChange({ cc_ae: event.target.checked })}
              />
              AE on cc for exceptional leads
            </label>
          </div>
          {kind === "dynamic" ? (
            <label className="grid gap-1 text-[12.5px] font-medium text-foreground">
              What the agent writes
              <textarea
                rows={2}
                className={input}
                placeholder="e.g. Share one customer example from Knowledge that matches their need, and offer the meeting link again."
                value={step.purpose}
                onChange={(event) => onChange({ purpose: event.target.value })}
              />
            </label>
          ) : (
            <TemplateEditor step={step} onChange={onChange} />
          )}
        </div>
      ) : (
        <div className="border-t border-border">
          {kind === "dynamic" ? (
            <p className="px-4 py-3 text-[13px] text-foreground">
              <span className="text-muted-foreground">The agent writes: </span>
              {step.purpose || (
                <em className="text-muted-foreground">
                  Say what this email is for.
                </em>
              )}
            </p>
          ) : (
            <>
              <p className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-[13px]">
                <span className="font-semibold text-foreground">Subject:</span>
                {step.thread === "reply" ? (
                  <em className="text-muted-foreground">
                    Re: the first touch's subject
                  </em>
                ) : (
                  <TokenText text={step.subject || "(no subject)"} />
                )}
              </p>
              <div
                className={cn(
                  "relative px-4 py-3 text-[13.5px] leading-relaxed text-foreground",
                  !open && "max-h-28 overflow-hidden",
                )}
              >
                <TokenText text={step.body} />
                {!open ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card" />
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setOpen(!open)}
                className="flex items-center gap-1 px-4 pb-2 text-[12.5px] font-medium text-foreground"
              >
                <IconChevronDown
                  className={cn(
                    "size-4 transition-transform",
                    open && "rotate-180",
                  )}
                  aria-hidden="true"
                />
                {open ? "See less" : "See more"}
              </button>
            </>
          )}
          {stats ? (
            <dl className="flex gap-6 border-t border-border px-4 py-2.5">
              <Stat label="Sent" value={String(stats.sent)} />
              <Stat
                label="Replies"
                value={
                  stats.sent
                    ? `${Math.round((stats.replies / stats.sent) * 100)}%`
                    : "0"
                }
              />
              <Stat
                label="Meetings"
                value={
                  stats.sent
                    ? `${Math.round((stats.meetings / stats.sent) * 100)}%`
                    : "0"
                }
              />
            </dl>
          ) : null}
        </div>
      )}
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dd className="text-[15px] font-semibold text-foreground">{value}</dd>
      <dt className="text-[11.5px] text-muted-foreground">{label}</dt>
    </div>
  );
}

function TemplateEditor({
  step,
  onChange,
}: {
  step: Step;
  onChange: (patch: Partial<Step>) => void;
}) {
  const insert = (token: string) =>
    onChange({ body: `${step.body}{{${token}}}` });
  return (
    <div className="grid gap-2">
      {step.thread === "new" ? (
        <label className="grid gap-1 text-[12.5px] font-medium text-foreground">
          Subject
          <input
            className={input}
            value={step.subject}
            placeholder="{{first_name}}, a quick thought on {{company}}"
            onChange={(event) => onChange({ subject: event.target.value })}
          />
        </label>
      ) : null}
      <label className="grid gap-1 text-[12.5px] font-medium text-foreground">
        Email
        <textarea
          rows={8}
          className={cn(input, "font-normal leading-relaxed")}
          value={step.body}
          onChange={(event) => onChange({ body: event.target.value })}
        />
      </label>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
        Insert:
        {TEMPLATE_TOKENS.map((item) => (
          <button
            key={item.token}
            type="button"
            onClick={() => insert(item.token)}
            className="rounded-md border border-border px-1.5 py-0.5 hover:bg-muted"
          >
            {item.label}
          </button>
        ))}
      </div>
      <label className="grid gap-1 text-[12.5px] font-medium text-foreground">
        Note for the rep (optional)
        <input
          className={input}
          value={step.purpose}
          onChange={(event) => onChange({ purpose: event.target.value })}
        />
      </label>
    </div>
  );
}
