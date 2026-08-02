// Shared source/CRM-provenance badge for contacts — makes it visible at a
// glance which platform a contact came from, and whether it's also a real
// HubSpot record. Used by contacts.tsx's table and lists.tsx's
// ListDetailView contact table; Task 6's contact detail drawer should reuse
// this rather than re-deriving the label/color logic.
//
// `source` and `hubspotUrl` are NOT assumed mutually exclusive: Task 4's
// cross-source dedup means a Prospector- or CommonRoom-sourced contact can
// carry a non-null `hubspotUrl` if it was matched to an existing HubSpot
// record. This component renders purely from the data as given — no
// inference beyond "is hubspotUrl set, and does source already say HubSpot".
const SOURCE_LABELS: Record<"hubspot" | "commonroom" | "prospector", string> = {
  hubspot: "HubSpot",
  commonroom: "CommonRoom",
  prospector: "Prospector",
};

// Distinct from ScorePill's palette (emerald = excellent, amber = good,
// muted = weak/unknown) so a source badge never reads as a score at a
// glance.
const SOURCE_COLORS: Record<"hubspot" | "commonroom" | "prospector", string> = {
  hubspot: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  commonroom: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  prospector: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
};

export interface SourceBadgeProps {
  source: "hubspot" | "commonroom" | "prospector";
  hubspotUrl?: string | null;
}

export function SourceBadge({ source, hubspotUrl }: SourceBadgeProps) {
  // When source is already "hubspot" the primary pill already says
  // "HubSpot" — a second "In HubSpot" pill would just repeat it.
  const showInHubSpot = Boolean(hubspotUrl) && source !== "hubspot";

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${SOURCE_COLORS[source]}`}
      >
        {SOURCE_LABELS[source]}
      </span>
      {showInHubSpot && (
        <span className="inline-flex items-center rounded-full border border-orange-500/40 px-2 py-0.5 text-[11px] font-medium text-orange-600 dark:text-orange-400">
          In HubSpot
        </span>
      )}
    </span>
  );
}
