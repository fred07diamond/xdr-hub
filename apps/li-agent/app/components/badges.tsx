import { IconSparkles } from "@tabler/icons-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Shared row badges, extracted because VerdictBadge and PersonaBadge each
// existed twice (app/routes/_index.tsx and app/routes/engagement.tsx) with
// neither exported, and the two VerdictBadge copies had already drifted: the
// _index.tsx one was MISSING a style for "inconclusive", so an inconclusive
// row indexed undefined and rendered an unstyled badge. That value is written
// by draftProfile whenever a workspace has no ICP document, so it is not an
// edge case.
//
// Deliberately NOT built on @agent-native/toolkit/ui/badge: its variants are
// default | destructive | outline | secondary, none of which map to the
// emerald/amber/rose verdict palette, so every use would override className
// anyway and gain nothing.

export type Verdict = "strong" | "possible" | "weak" | "inconclusive" | null;

// The 4-key version from engagement.tsx, which is the complete one.
const VERDICT_STYLES: Record<NonNullable<Verdict>, string> = {
  strong: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  possible: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  weak: "bg-rose-500/15 text-rose-500 dark:text-rose-400",
  inconclusive: "bg-muted text-muted-foreground",
};

/**
 * `fallback` keeps both original call sites rendering as they did: the
 * Prospects table shows an em dash for an unscored lead, Engagement shows
 * nothing at all.
 */
export function VerdictBadge({
  verdict,
  fallback = <span className="text-xs text-muted-foreground/50">—</span>,
  title,
}: {
  verdict: Verdict | string | null | undefined;
  fallback?: React.ReactNode;
  title?: string;
}) {
  const style = verdict ? VERDICT_STYLES[verdict as NonNullable<Verdict>] : undefined;
  if (!verdict || !style) return <>{fallback}</>;
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize",
        style,
      )}
    >
      {verdict}
    </span>
  );
}

/**
 * `variant` exists so all three existing call sites keep their current
 * appearance: Engagement uses a solid colored pill with white text, while the
 * Prospects and Lead Lists tables use a muted pill with a small color dot.
 * Unifying those two looks is a cosmetic decision worth making on its own,
 * not smuggled into a refactor.
 */
export function PersonaBadge({
  name,
  color,
  variant = "dot",
}: {
  name: string | null;
  color: string | null;
  variant?: "dot" | "solid";
}) {
  if (!name) return null;

  if (variant === "solid") {
    return (
      <span
        className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white"
        style={{ backgroundColor: color ?? "#6366f1" }}
      >
        {name}
      </span>
    );
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
      <span
        className="inline-block size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: color ?? "#6366f1" }}
      />
      {name}
    </span>
  );
}

/**
 * Marks a lead worth spending credits on.
 *
 * The point is behavioural, not decorative: Apollo credits are finite and
 * shared, so the table should make the good leads the obvious ones to act on.
 * Uses the real Radix tooltip rather than a `title` attribute (which is what
 * every other cell in these tables uses) because the reason a lead is stellar
 * is worth reading, and a native tooltip is slow to appear and easy to miss.
 */
export function StellarMark({ personaName }: { personaName?: string | null }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex shrink-0 items-center text-amber-500" aria-label="Stellar fit">
          <IconSparkles size={12} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        {personaName
          ? `Stellar fit — strong ICP match in the ${personaName} persona`
          : "Stellar fit — you rated this lead a thumbs up"}
      </TooltipContent>
    </Tooltip>
  );
}
