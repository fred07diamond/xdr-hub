import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// Shared score-pill styling for contact scores (overallScore,
// personaMatchScore, companyFitScore, engagementScore) — used by both
// contacts.tsx and segments.tsx so a given score renders identically
// wherever it appears. Previously lived as private, unexported functions
// inside contacts.tsx; extracted here once segments.tsx needed the same
// styling for its own score columns.
export function scoreBadge(score: number | null) {
  if (score == null) {
    return { label: "—", className: "bg-muted text-muted-foreground" };
  }
  if (score >= 80) {
    return { label: `Excellent · ${score}`, className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" };
  }
  if (score >= 50) {
    return { label: `Good · ${score}`, className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" };
  }
  return { label: `Weak · ${score}`, className: "bg-muted text-muted-foreground" };
}

export interface ScoreBreakdownItem {
  label: string;
  value: number | null;
  bucket: "Fit" | "Intent";
}

export interface ScoreInfo {
  title: string;
  description: string;
  // Persona Match / Company Fit are produced by the same per-contact AI
  // scoring call and share one written explanation (contacts.scoreReasoning)
  // — pass it through here to show alongside the static description.
  // Omitted (or null) for scores this app doesn't generate any reasoning
  // for at all (CommonRoom/HubSpot pass-through numbers) — the static
  // description alone still answers "what does this number even mean".
  reasoning?: string | null;
}

// Static "what does this score mean" copy for every non-Overall-Score pill
// this app renders — defined once here so ContactsTable.tsx/ContactDrawer.tsx
// can't drift on wording for the same score shown in two places. Overall
// Score gets its own dedicated breakdown tooltip (buildOverallScoreBreakdown
// below) rather than this simpler title+description+reasoning shape, since
// it's a computed blend of several of these scores rather than a single
// judged/sourced value itself.
export const SCORE_INFO: Record<
  "personaMatch" | "companyFit" | "engagement" | "hubspotQl" | "commonRoomIntent" | "commonRoomCompanyFit",
  Omit<ScoreInfo, "reasoning">
> = {
  personaMatch: {
    title: "How Persona Match is scored",
    description:
      "AI-judged fit between this contact's title and the matched persona's target criteria — based only on the title itself, never inferring seniority or responsibilities it doesn't state.",
  },
  companyFit: {
    title: "How Company Fit is scored",
    description:
      'AI-judged fit between this contact\'s company and the persona\'s company-level criteria (size, industry, tech stack) — scored 50 ("neutral") when there\'s no clear signal either way. When real company size/location data is available (e.g. from a Prospector-sourced Active List), this score comes from a calculated formula instead, which may not exactly match the written reasoning below.',
  },
  engagement: {
    title: "About Engagement",
    description:
      'CommonRoom\'s own "Contact Score V2" — a blended fit + intent signal CommonRoom computes on their side from this contact\'s engagement and firmographic data. The specific factors behind it live in CommonRoom, not in this app.',
  },
  hubspotQl: {
    title: "About HubSpot QL Score",
    description: "Synced directly from this contact's HubSpot record — HubSpot's own lead-quality scoring, not something this app calculates.",
  },
  commonRoomIntent: {
    title: "About CommonRoom Intent Score",
    description:
      'CommonRoom\'s own "Contact Intent Score" — reflects recent engagement signals (site visits, content consumption, etc.) CommonRoom tracks on their side.',
  },
  commonRoomCompanyFit: {
    title: "About CommonRoom Company Fit",
    description:
      "CommonRoom's own org-level Company Fit score — how well this contact's company matches your configured ideal customer profile on CommonRoom's side, independent of this app's own Company Fit score above.",
  },
};

// Overall Score's breakdown, in the same order/grouping every hover shows —
// built here (not per-caller) so contacts.tsx and segments.tsx can't drift
// on which fields count or how they're labeled.
export function buildOverallScoreBreakdown(contact: {
  personaMatchScore: number | null;
  companyFitScore: number | null;
  hubspotQlScore: number | null;
  engagementScore: number | null;
  commonRoomCompanyFitScore: number | null;
  commonRoomIntentScore: number | null;
}): ScoreBreakdownItem[] {
  return [
    { label: "Persona Match", value: contact.personaMatchScore, bucket: "Fit" },
    { label: "Company Fit", value: contact.companyFitScore, bucket: "Fit" },
    { label: "HubSpot QL Score", value: contact.hubspotQlScore, bucket: "Fit" },
    { label: "CommonRoom Fit (Contact Score V2)", value: contact.engagementScore, bucket: "Fit" },
    { label: "CommonRoom Company Fit", value: contact.commonRoomCompanyFitScore, bucket: "Fit" },
    { label: "CommonRoom Intent Score", value: contact.commonRoomIntentScore, bucket: "Intent" },
  ];
}

export function ScorePill({
  score,
  size = "sm",
  breakdown,
  info,
}: {
  score: number | null;
  size?: "sm" | "lg";
  breakdown?: ScoreBreakdownItem[];
  // Simpler alternative to `breakdown`, for a score that's a single judged/
  // sourced value rather than a computed blend of other scores — mutually
  // exclusive with `breakdown` in practice (Overall Score uses breakdown;
  // every other score pill uses info).
  info?: ScoreInfo;
}) {
  const badge = scoreBadge(score);
  const sizeClass = size === "lg" ? "px-2.5 py-1 text-sm" : "px-2 py-0.5 text-xs";
  const pill = (
    <span className={`inline-flex items-center rounded-full font-medium ${sizeClass} ${badge.className}`}>
      {badge.label}
    </span>
  );

  if (!breakdown && !info) return pill;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help">{pill}</span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="w-64 space-y-2 p-3">
          {breakdown ? (
            <OverallScoreBreakdownContent breakdown={breakdown} />
          ) : info ? (
            <ScoreInfoContent info={info} />
          ) : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function OverallScoreBreakdownContent({ breakdown }: { breakdown: ScoreBreakdownItem[] }) {
  const available = breakdown.filter((b) => b.value != null);
  const missing = breakdown.filter((b) => b.value == null);

  return (
    <>
      <div>
        <p className="text-[11px] font-semibold text-foreground">How Overall Score is calculated</p>
        <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
          50% average of available <span className="font-medium text-foreground">Fit</span> signals + 50%{" "}
          <span className="font-medium text-foreground">Intent</span> signal. A signal that isn&apos;t available
          is excluded from its bucket&apos;s average, never counted as zero.
        </p>
      </div>
      <div className="space-y-1 border-t border-border pt-2">
        {available.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="text-muted-foreground">
              {item.label} <span className="text-muted-foreground/50">({item.bucket})</span>
            </span>
            <span className="font-medium text-foreground">{item.value}</span>
          </div>
        ))}
        {missing.length > 0 && (
          <div className="pt-1 text-[10px] text-muted-foreground/50">
            Not available: {missing.map((m) => m.label).join(", ")}
          </div>
        )}
      </div>
    </>
  );
}

function ScoreInfoContent({ info }: { info: ScoreInfo }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-foreground">{info.title}</p>
      <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{info.description}</p>
      {info.reasoning && (
        <div className="mt-2 border-t border-border pt-2">
          <p className="text-[10px] font-medium text-foreground">This contact&apos;s reasoning</p>
          <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{info.reasoning}</p>
        </div>
      )}
    </div>
  );
}
