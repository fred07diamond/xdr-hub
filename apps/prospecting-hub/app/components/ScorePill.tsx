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

export function ScorePill({ score, size = "sm" }: { score: number | null; size?: "sm" | "lg" }) {
  const badge = scoreBadge(score);
  const sizeClass = size === "lg" ? "px-2.5 py-1 text-sm" : "px-2 py-0.5 text-xs";
  return (
    <span className={`inline-flex items-center rounded-full font-medium ${sizeClass} ${badge.className}`}>
      {badge.label}
    </span>
  );
}
