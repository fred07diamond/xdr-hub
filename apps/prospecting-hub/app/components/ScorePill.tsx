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
}: {
  score: number | null;
  size?: "sm" | "lg";
  breakdown?: ScoreBreakdownItem[];
}) {
  const badge = scoreBadge(score);
  const sizeClass = size === "lg" ? "px-2.5 py-1 text-sm" : "px-2 py-0.5 text-xs";
  const pill = (
    <span className={`inline-flex items-center rounded-full font-medium ${sizeClass} ${badge.className}`}>
      {badge.label}
    </span>
  );

  if (!breakdown) return pill;

  const available = breakdown.filter((b) => b.value != null);
  const missing = breakdown.filter((b) => b.value == null);

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help">{pill}</span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="w-64 space-y-2 p-3">
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
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
