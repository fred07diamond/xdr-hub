// Sequencing (D102): the follow-ups waiting on someone across every lead,
// and the cadence for each route. The cadence is still a playbook block
// (D101), so an edit lands in your playbook draft and the owner or a
// Playbook admin approves it before it takes effect (D76).
import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { CADENCE_ROUTES } from "@shared/cadence";
import {
  IconArrowRight,
  IconCheck,
  IconPlus,
  IconSend,
  IconTimelineEvent,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { CadenceEditor } from "@/components/pa/block-editors";
import { KindChip } from "@/components/pa/sequence-ui";
import { EmptyState, ErrorState } from "@/components/pa/states";
import { Button } from "@/components/ui/button";
import { APP_TITLE } from "@/lib/app-config";
import { cn } from "@/lib/utils";

export function meta() {
  return [{ title: `Sequencing - ${APP_TITLE}` }];
}

interface FollowUpRow {
  id: string;
  engagementId: string;
  lead: string;
  leadEmail: string | null;
  owner: string | null;
  mine: boolean;
  route: string;
  step: number;
  of: number;
  day: number;
  purpose: string;
  status: "scheduled" | "drafted" | "needs_edit";
  dueAt: string;
  due: boolean;
}

interface CadenceBlock {
  target: string;
  block: string | null;
  data: Record<string, unknown>;
  raw: Record<string, unknown> | null;
}
interface PlaybookData {
  viewer: { role: string | null; isAppOwner: boolean };
  sections: Array<{ id: string; blocks: CadenceBlock[] }>;
  myDraft: { id: string; itemCount: number } | null;
}

const ROUTE_LABEL = Object.fromEntries(
  CADENCE_ROUTES.map((item) => [item.route, item.label]),
) as Record<string, string>;

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

const STATUS: Record<
  FollowUpRow["status"],
  { label: string; className: string }
> = {
  drafted: {
    label: "Ready to send",
    className: "bg-primary-soft text-primary",
  },
  needs_edit: {
    label: "Fix before sending",
    className: "bg-warning-soft text-warning-foreground",
  },
  scheduled: {
    label: "Agent writing",
    className: "text-muted-foreground ring-1 ring-inset ring-border",
  },
};

export default function SequencingRoute() {
  const followUps = useActionQuery(
    "list-follow-ups",
    {},
    { refetchInterval: 60_000 },
  );
  const data = followUps.data as
    | { due: FollowUpRow[]; upcoming: FollowUpRow[]; activeLeads: number }
    | undefined;
  return (
    <div className="mx-auto grid w-full max-w-[1100px] gap-6 px-3 py-4 sm:px-4 md:px-6 md:py-5">
      <header>
        <h1 className="text-[18px] font-semibold text-foreground">
          Sequencing
        </h1>
        <p className="mt-0.5 max-w-[64ch] text-[13px] text-muted-foreground">
          After the first touch, each lead follows its route's cadence. The
          agent writes every follow-up the day before it is due; the lead's
          owner sends it from their Gmail as a reply in the same thread. It
          stops when the lead replies, books, bounces, opts out, or HubSpot
          moves them on, and pauses while they are out of office.
        </p>
      </header>

      <section aria-label="Follow-ups" className="grid gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[14px] font-semibold text-foreground">Due now</h2>
          {data ? (
            <span className="flex items-center gap-3">
              <span className="text-[12px] text-muted-foreground">
                {data.activeLeads} {data.activeLeads === 1 ? "lead" : "leads"}{" "}
                in a sequence
              </span>
              {data.due.some(
                (row) => row.mine && row.status !== "scheduled",
              ) ? (
                <Button asChild size="sm">
                  <Link to="/sequencing/queue">
                    <IconSend className="size-4" aria-hidden="true" />
                    Start sending (
                    {
                      data.due.filter(
                        (row) => row.mine && row.status !== "scheduled",
                      ).length
                    }
                    )
                  </Link>
                </Button>
              ) : null}
            </span>
          ) : null}
        </div>
        {followUps.isPending ? (
          <div className="h-24 animate-pulse rounded-lg border border-border bg-card" />
        ) : !data ? (
          <ErrorState
            title="Couldn't load the follow-ups"
            error={followUps.error}
            onRetry={() => void followUps.refetch()}
          />
        ) : data.due.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-5 text-[13px] text-muted-foreground">
            Nothing due. Follow-ups show up here when they are due.
          </p>
        ) : (
          <FollowUpList rows={data.due} />
        )}
        {data && data.upcoming.length > 0 ? (
          <details className="group">
            <summary className="cursor-pointer text-[12.5px] font-medium text-muted-foreground">
              Coming up ({data.upcoming.length})
            </summary>
            <div className="mt-2">
              <FollowUpList rows={data.upcoming} />
            </div>
          </details>
        ) : null}
      </section>

      <Sequences />

      <Cadences />
    </div>
  );
}

function FollowUpList({ rows }: { rows: FollowUpRow[] }) {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-card">
      {rows.map((row) => (
        <li key={row.id}>
          <Link
            to={`/inbound/${row.engagementId}`}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-foreground">
                {row.lead}
                <span className="ml-2 font-normal text-muted-foreground">
                  Follow-up {row.step} of {row.of}, day {row.day}
                </span>
              </p>
              <p className="truncate text-[12px] text-muted-foreground">
                {row.mine ? "Yours" : (row.owner ?? "No owner")} ·{" "}
                {ROUTE_LABEL[row.route] ?? row.route} · {row.purpose}
              </p>
            </div>
            <span className="hidden whitespace-nowrap text-[12px] text-muted-foreground sm:inline">
              {when(row.dueAt)}
            </span>
            <span
              className={cn(
                "inline-flex h-[22px] items-center whitespace-nowrap rounded-[5px] px-1.5 text-[11.5px] font-medium",
                STATUS[row.status].className,
              )}
            >
              {STATUS[row.status].label}
            </span>
            <IconArrowRight
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The cadence per route, edited here and approved like any playbook edit. */
function Cadences() {
  const query = useActionQuery("list-playbook", {});
  const propose = useActionMutation("propose-playbook-change");
  const update = useActionMutation("update-playbook-change");
  const playbook = query.data as PlaybookData | undefined;
  const block = useMemo(
    () =>
      playbook?.sections
        .flatMap((section) => section.blocks)
        .find((item) => item.block === "cadence") ?? null,
    [playbook],
  );
  const saved = useMemo(
    () => (block?.data ?? {}) as Record<string, unknown>,
    [block],
  );
  const [data, setData] = useState<Record<string, unknown>>(saved);
  useEffect(() => setData(saved), [saved]);
  const dirty = JSON.stringify(data) !== JSON.stringify(saved);
  const canEdit = Boolean(
    playbook && (playbook.viewer.isAppOwner || playbook.viewer.role),
  );
  const busy = propose.isPending || update.isPending;

  if (query.isPending)
    return (
      <div className="h-72 animate-pulse rounded-lg border border-border bg-card" />
    );
  if (!playbook)
    return (
      <ErrorState
        title="Couldn't load the sending settings"
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  if (!block)
    return (
      <EmptyState
        icon={IconTimelineEvent}
        title="No cadence in the playbook yet"
      >
        It is added when the playbook upgrades. Reload in a minute.
      </EmptyState>
    );

  const stage = () => {
    const items = [
      {
        target: block.target,
        op: "update" as const,
        after: { ...block.raw, params: data },
      },
    ];
    const done = {
      onSuccess: () => {
        toast.success(
          "Settings staged in your playbook draft. Submit it for approval.",
        );
        void query.refetch();
      },
      onError: (error: unknown) => toast.error(actionErrorMessage(error)),
    };
    if (playbook.myDraft)
      update.mutate({ changeId: playbook.myDraft.id, set: items }, done);
    else
      propose.mutate(
        {
          title: "Sending settings",
          rationale: "Edited on the Sequencing page",
          items,
        },
        done,
      );
  };

  return (
    <section aria-label="Sending settings" className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-[14px] font-semibold text-foreground">
            Sending settings
          </h2>
          <p className="text-[12.5px] text-muted-foreground">
            The send window and daily caps for every sequence. These are
            playbook rules, so edits go to your playbook draft for approval.
          </p>
        </div>
        {playbook.myDraft ? (
          <Button asChild size="sm" variant="outline">
            <Link to={`/playbook/changes/${playbook.myDraft.id}`}>
              Review your draft ({playbook.myDraft.itemCount})
            </Link>
          </Button>
        ) : null}
      </div>
      <div
        className={cn(
          "rounded-lg border border-border bg-card p-4",
          !canEdit && "pointer-events-none opacity-80",
        )}
      >
        <CadenceEditor data={data} onChange={setData} settingsOnly />
      </div>
      {canEdit && dirty ? (
        <div className="sticky bottom-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
          <Button type="button" size="sm" disabled={busy} onClick={stage}>
            <IconCheck className="size-4" aria-hidden="true" />
            Save to my draft
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setData(saved)}
          >
            Discard
          </Button>
          <span className="text-[12px] text-muted-foreground">
            Takes effect once approved.
          </span>
        </div>
      ) : !canEdit ? (
        <p className="text-[12px] text-muted-foreground">
          Only the PA team, RevOps, or the app owner can edit these.
        </p>
      ) : null}
    </section>
  );
}

interface SequenceCard {
  id: string;
  name: string;
  kind: "dynamic" | "template";
  description: string;
  recommendedFor: string[];
  archived: boolean;
  steps: Array<{ day: number }>;
  enrolled: number;
  active: number;
  sent: number;
  replies: number;
  meetings: number;
}

/** The team's sequences (D105): open one to edit it, or make a new one. */
function Sequences() {
  const query = useActionQuery("list-sequences", {});
  const sequences =
    (query.data as { sequences?: SequenceCard[] } | undefined)?.sequences ?? [];
  return (
    <section aria-label="Sequences" className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-[14px] font-semibold text-foreground">
            Sequences
          </h2>
          <p className="text-[12.5px] text-muted-foreground">
            Pick one on a lead after the first touch. Agent-written: the agent
            writes each email and you approve each. Editable: you review the
            emails when enrolling, and they send on their days.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/sequencing/new-template">
              <IconPlus className="size-4" aria-hidden="true" />
              Editable
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/sequencing/new">
              <IconPlus className="size-4" aria-hidden="true" />
              Agent-written
            </Link>
          </Button>
        </div>
      </div>
      {query.isPending ? (
        <div className="h-32 animate-pulse rounded-lg border border-border bg-card" />
      ) : query.error ? (
        <ErrorState
          title="Couldn't load the sequences"
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {sequences.map((sequence) => {
            const days = Math.max(...sequence.steps.map((step) => step.day));
            return (
              <li key={sequence.id}>
                <Link
                  to={`/sequencing/${sequence.id}`}
                  className="grid h-full gap-2 rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/30"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-semibold text-foreground">
                      {sequence.name}
                    </p>
                    <KindChip kind={sequence.kind} />
                  </div>
                  <p className="text-[12.5px] text-muted-foreground">
                    {sequence.steps.length}{" "}
                    {sequence.steps.length === 1 ? "email" : "emails"} over{" "}
                    {days} {days === 1 ? "day" : "days"}
                    {sequence.recommendedFor.length > 0
                      ? ` · suggested for ${sequence.recommendedFor
                          .map((route) => ROUTE_LABEL[route] ?? route)
                          .join(", ")}`
                      : ""}
                  </p>
                  <dl className="mt-auto flex gap-5 text-[12px]">
                    <div>
                      <dd className="font-semibold text-foreground">
                        {sequence.active}
                      </dd>
                      <dt className="text-muted-foreground">Active</dt>
                    </div>
                    <div>
                      <dd className="font-semibold text-foreground">
                        {sequence.sent}
                      </dd>
                      <dt className="text-muted-foreground">Sent</dt>
                    </div>
                    <div>
                      <dd className="font-semibold text-foreground">
                        {sequence.sent
                          ? `${Math.round((sequence.replies / sequence.sent) * 100)}%`
                          : "0"}
                      </dd>
                      <dt className="text-muted-foreground">Replies</dt>
                    </div>
                    <div>
                      <dd className="font-semibold text-foreground">
                        {sequence.meetings}
                      </dd>
                      <dt className="text-muted-foreground">Meetings</dt>
                    </div>
                  </dl>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
