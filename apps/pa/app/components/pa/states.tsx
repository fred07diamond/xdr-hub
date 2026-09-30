import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { IconAlertCircle, IconRefresh, type Icon } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: IconComponent,
  title,
  children,
  action,
  className,
}: {
  icon: Icon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center px-6 py-14 text-center",
        className,
      )}
    >
      <span className="mb-4 flex size-10 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-xs">
        <IconComponent
          className="size-5"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </span>
      <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
      {children ? (
        <div className="mt-1.5 max-w-md text-[13px] leading-relaxed text-muted-foreground">
          {children}
        </div>
      ) : null}
      {action ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action}
        </div>
      ) : null}
    </div>
  );
}

export function ErrorState({
  title,
  error,
  onRetry,
  extraAction,
  className,
}: {
  title: string;
  error: unknown;
  onRetry?: () => void;
  extraAction?: ReactNode;
  className?: string;
}) {
  const message =
    actionErrorMessage(error) ??
    (error instanceof Error ? error.message : "Something went wrong.");
  return (
    <EmptyState
      icon={IconAlertCircle}
      title={title}
      className={className}
      action={
        onRetry || extraAction ? (
          <>
            {onRetry ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRetry}
              >
                <IconRefresh className="size-4" aria-hidden="true" />
                Try again
              </Button>
            ) : null}
            {extraAction}
          </>
        ) : null
      }
    >
      <p>{message}</p>
    </EmptyState>
  );
}

export function PlaceholderPage({
  icon: IconComponent,
  title,
  summary,
  planned,
}: {
  icon: Icon;
  title: string;
  summary: string;
  planned: string[];
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <div className="rounded-lg border border-border bg-card shadow-xs">
        <div className="flex items-start gap-4 border-b border-border p-5 md:p-6">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
            <IconComponent
              className="size-5"
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold text-foreground">
                {title}
              </h2>
              <span className="rounded-[4px] border border-dashed border-foreground/30 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                Not built yet
              </span>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              {summary}
            </p>
          </div>
        </div>
        <div className="p-5 md:p-6">
          <h3 className="text-[12px] font-medium text-muted-foreground">
            Planned for this page
          </h3>
          <ul className="mt-3 space-y-2">
            {planned.map((item) => (
              <li
                key={item}
                className="flex gap-2.5 text-[13px] leading-relaxed text-foreground"
              >
                <span
                  aria-hidden="true"
                  className="mt-[7px] size-1.5 shrink-0 rounded-full bg-foreground/40"
                />
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-6 rounded-md bg-muted/70 px-3 py-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
            This page is a placeholder. Keep prompting to build it next.
          </p>
        </div>
      </div>
    </div>
  );
}
