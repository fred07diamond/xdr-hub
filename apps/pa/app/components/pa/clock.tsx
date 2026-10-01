import type {
  ClockView,
  SalesStageView,
  SlaMilestone,
  SlaView,
} from "@shared/pa-views";
import {
  IconAlertOctagon,
  IconAlertTriangle,
  IconCheck,
  IconClock,
  IconClockPause,
  IconMinus,
} from "@tabler/icons-react";

import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const TONE: Record<ClockView["status"], string> = {
  none: "text-muted-foreground",
  not_started: "text-muted-foreground",
  running: "text-foreground",
  at_risk: "text-warning-foreground",
  breached: "text-destructive-strong",
  met: "text-muted-foreground",
};

const ICON: Record<ClockView["status"], typeof IconClock> = {
  none: IconMinus,
  not_started: IconClockPause,
  running: IconClock,
  at_risk: IconAlertTriangle,
  breached: IconAlertOctagon,
  met: IconCheck,
};

/** The rail for the SLA timer's current milestone. */
function SlaTimerRail({
  sla,
  className,
}: {
  sla: SlaView;
  className?: string;
}) {
  if (sla.fraction === null || sla.phase === "none") return null;
  const fraction =
    sla.status === "breached" ? 1 : Math.max(0, Math.min(1, sla.fraction));
  return (
    <div
      className={cn(
        "relative h-1 w-full overflow-hidden rounded-full bg-rail",
        className,
      )}
      role="meter"
      aria-label="SLA time used"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
    >
      <div
        className={cn(
          "h-full rounded-full",
          sla.status === "at_risk"
            ? "bg-warning"
            : sla.status === "breached"
              ? "bg-destructive"
              : sla.status === "met"
                ? "bg-primary/60"
                : "bg-rail-fill",
        )}
        style={{ width: `${fraction * 100}%` }}
      />
      {sla.status !== "met" ? (
        <div
          aria-hidden="true"
          className="absolute inset-y-0 w-px bg-foreground/35"
          style={{ left: `${sla.reminderFraction * 100}%` }}
        />
      ) : null}
    </div>
  );
}

const SLA_TONE: Record<ClockView["status"], string> = {
  ...TONE,
  met: "text-primary",
};

/** The SLA timer as a compact cell: board rows and the record header. */
export function SlaCell({ sla }: { sla: SlaView }) {
  const Icon = ICON[sla.status];
  return (
    <div className="flex min-w-0 flex-col gap-1.5" title={sla.detail}>
      <span
        className={cn(
          "inline-flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium tabular-nums",
          SLA_TONE[sla.status],
        )}
      >
        <Icon
          className="size-3.5 shrink-0"
          strokeWidth={2}
          aria-hidden="true"
        />
        <span className="truncate">{sla.label}</span>
      </span>
      <SlaTimerRail sla={sla} className="max-w-[112px]" />
    </div>
  );
}

function MilestoneRow({
  title,
  milestone,
  timezone,
}: {
  title: string;
  milestone: SlaMilestone;
  timezone: string | null;
}) {
  const Icon = ICON[milestone.status];
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-muted-foreground">{title}</p>
        <p
          className={cn(
            "mt-0.5 inline-flex items-center gap-1.5 text-[13.5px] font-medium",
            SLA_TONE[milestone.status],
          )}
        >
          <Icon
            className="size-4 shrink-0"
            strokeWidth={2}
            aria-hidden="true"
          />
          {milestone.label}
        </p>
      </div>
      <p className="shrink-0 text-right text-[12px] text-muted-foreground">
        {milestone.doneAt
          ? `Done ${formatDateTime(milestone.doneAt, timezone)}`
          : milestone.dueAt
            ? `Due ${formatDateTime(milestone.dueAt, timezone)}`
            : null}
      </p>
    </div>
  );
}

/** The SLA timer in full: both milestones, with due and done times. */
export function SlaDetail({
  sla,
  timezone,
}: {
  sla: SlaView;
  timezone: string | null;
}) {
  return (
    <div className="space-y-4">
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        Triage is automatic. The SLA timer marks when a person contacted the
        lead, then when the owner marked it SAL.
      </p>
      <MilestoneRow
        title="1. First contact"
        milestone={sla.contact}
        timezone={timezone}
      />
      <MilestoneRow
        title="2. Marked SAL"
        milestone={sla.sal}
        timezone={timezone}
      />
      <SlaTimerRail sla={sla} />
      <p className="text-[12px] text-muted-foreground">{sla.detail}</p>
    </div>
  );
}

const shortDate = (iso: string) =>
  new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(
    new Date(iso),
  );

/** QL, SAL, S0, NBM booked, NBM complete, S1, with the SLA timer. */
export function SalesCycle({
  stages,
  sla,
}: {
  stages: SalesStageView[];
  sla: SlaView;
}) {
  return (
    <div className="flex flex-col gap-3 @min-[48rem]:flex-row @min-[48rem]:items-center">
      <ol
        aria-label="Sales cycle"
        className="flex min-w-0 flex-1 items-start overflow-x-auto py-0.5"
      >
        {stages.map((stage, index) => (
          <li
            key={stage.code}
            className="flex min-w-[4.5rem] flex-1 flex-col items-start gap-1"
            title={stage.note ?? undefined}
            aria-current={stage.status === "current" ? "step" : undefined}
          >
            <div className="flex w-full items-center">
              <span
                aria-hidden="true"
                // Borders, not rings: a ring is a box-shadow, and the
                // scrolling list clips it into a broken circle.
                className={cn(
                  "box-border size-2.5 shrink-0 rounded-full border",
                  stage.status === "done"
                    ? "border-primary bg-primary"
                    : stage.status === "current"
                      ? "border-2 border-primary bg-card"
                      : stage.status === "stopped"
                        ? "border-muted-foreground/40 bg-muted-foreground/40"
                        : "border-muted-foreground/45 bg-card",
                )}
              />
              {index < stages.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "mx-1 h-px flex-1",
                    stages[index + 1].status === "done"
                      ? "bg-primary/60"
                      : "bg-muted-foreground/25",
                  )}
                />
              ) : null}
            </div>
            <span
              className={cn(
                "whitespace-nowrap text-[12px]",
                stage.status === "done" || stage.status === "current"
                  ? "font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {stage.label}
            </span>
            <span className="whitespace-nowrap text-[11px] text-muted-foreground">
              {stage.status === "done"
                ? stage.at
                  ? shortDate(stage.at)
                  : "Done"
                : stage.status === "current"
                  ? "Next"
                  : stage.status === "stopped"
                    ? "Stopped"
                    : ""}
            </span>
          </li>
        ))}
      </ol>
      <div className="shrink-0 border-border @min-[48rem]:w-48 @min-[48rem]:border-l @min-[48rem]:pl-4">
        <p className="text-[11px] text-muted-foreground">SLA timer</p>
        <div className="mt-0.5">
          <SlaCell sla={sla} />
        </div>
      </div>
    </div>
  );
}
