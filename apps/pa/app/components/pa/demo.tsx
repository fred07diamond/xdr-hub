import { IconFlask2 } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const SNAPSHOT_FORMAT = new Intl.DateTimeFormat("en", {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

export function DemoToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-card px-2.5 shadow-xs">
      <Switch
        id="pa-demo-toggle"
        size="sm"
        checked={enabled}
        onCheckedChange={onChange}
        className="data-[state=checked]:bg-ink"
      />
      <label
        htmlFor="pa-demo-toggle"
        className="cursor-pointer select-none text-[13px] font-medium text-foreground"
      >
        Demo data
      </label>
    </div>
  );
}

export function DemoNotice({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed border-foreground/25 bg-secondary/60 px-3 py-2"
    >
      <IconFlask2
        className="size-4 shrink-0 text-muted-foreground"
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-foreground">
        {children}
      </p>
      {action}
    </div>
  );
}

export function DemoBanner({
  total,
  generatedAt,
  onTurnOff,
}: {
  total: number | null;
  generatedAt: string | null;
  onTurnOff: () => void;
}) {
  return (
    <DemoNotice
      action={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[12.5px]"
          onClick={onTurnOff}
        >
          Turn off
        </Button>
      }
    >
      <span className="font-medium">Demo data.</span>{" "}
      {total === null ? "These leads are" : `These ${total} leads are`} made up
      and run through the real rules in your browser
      {generatedAt
        ? `, as of ${SNAPSHOT_FORMAT.format(new Date(generatedAt))}`
        : ""}
      . Nothing is saved or sent.
    </DemoNotice>
  );
}

export function DemoPill({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-foreground/30 px-2 text-[11.5px] font-medium leading-none text-foreground",
        className,
      )}
      title="Demo data: the board shows made-up leads computed in this browser"
    >
      <IconFlask2 className="size-3" strokeWidth={2} aria-hidden="true" />
      Demo data
    </span>
  );
}
