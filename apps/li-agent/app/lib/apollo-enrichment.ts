import { useActionQuery } from "@agent-native/core/client/hooks";

// Client-side view of whether Apollo enrichment is available, replacing the
// compile-time APOLLO_ENRICHMENT_DISABLED constant that used to live in
// app/lib/feature-flags.ts (and had to be kept manually in sync with a
// duplicate server constant).
//
// This is PRESENTATIONAL ONLY. The server re-checks everything in
// reserveEnrichment, so nothing here is trusted -- its job is to avoid
// offering a button that is certain to be rejected.

export interface ApolloEnrichmentStatus {
  enabled: boolean;
  unavailable?: boolean;
  phoneRevealsEnabled: boolean;
  tier?: "ok" | "phone_blocked" | "hard_stop";
  message?: string;
  periodEnd?: string;
  resetLabel?: string;
  budget?: number;
  spent?: number;
  remaining?: number;
  spentPct?: number;
  phoneStopPct?: number;
  userLimit?: number | null;
  userRemaining?: number | null;
  costPerEmail?: number;
  costPerPhoneReveal?: number;
}

export interface ApolloEnrichmentGate {
  /** True only when we positively know enrichment is available. */
  enabled: boolean;
  /** True while the status is still being fetched -- render a neutral state. */
  isLoading: boolean;
  phoneRevealsEnabled: boolean;
  status: ApolloEnrichmentStatus | null;
  /** Why enrichment is unavailable, if it is. Safe to show in a tooltip. */
  message: string;
}

export const APOLLO_ENRICHMENT_PAUSED_MESSAGE = "Apollo enrichment is paused for this workspace";

/**
 * Deliberately NOT the framework's `useFeatureFlag`.
 *
 * That hook returns a bare boolean which is `false` while the query is in
 * flight, so every Enrich button in the app would flash "disabled" on each
 * page load before settling. Exposing `isLoading` separately lets callers
 * render a neutral pending state instead.
 *
 * On ERROR this reports enabled: the server is the real gate and will reject
 * the call anyway, so a blip in this status query should not take the product
 * down. The cost of being wrong is one rejected click with a clear message;
 * the cost of the opposite default is an app that looks broken whenever a
 * read hiccups.
 *
 * Every row calls this rather than threading a prop down -- react-query
 * dedupes, so a 25-row table still issues one request.
 */
export function useApolloEnrichment(): ApolloEnrichmentGate {
  const query = useActionQuery("get-apollo-enrichment-status", {}, {
    // Credits move as colleagues work, and this feeds the cost estimate, so
    // it should not be stale for long. Not aggressive: the same key backs
    // every row, the bulk estimate and the admin banner.
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
  });

  const status = (query.data as ApolloEnrichmentStatus | undefined) ?? null;

  if (query.isLoading) {
    return { enabled: false, isLoading: true, phoneRevealsEnabled: false, status: null, message: "" };
  }
  if (query.isError || !status) {
    return {
      enabled: true,
      isLoading: false,
      phoneRevealsEnabled: true,
      status: null,
      message: "",
    };
  }

  return {
    enabled: status.enabled,
    isLoading: false,
    phoneRevealsEnabled: status.phoneRevealsEnabled,
    status,
    message: status.enabled
      ? status.phoneRevealsEnabled
        ? ""
        : `Phone reveals are paused until ${status.resetLabel ?? "the next period"} — the workspace has used ${status.spentPct ?? 0}% of its Apollo credits. Email enrichment still works.`
      : (status.message ?? APOLLO_ENRICHMENT_PAUSED_MESSAGE),
  };
}

/** Formats a credit count for UI copy. */
export function formatCredits(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString();
}
