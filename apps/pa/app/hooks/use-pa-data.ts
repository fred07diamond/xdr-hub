import { useActionQuery } from "@agent-native/core/client/hooks";
import { isDemoId } from "@shared/demo";
import type {
  BoardResult,
  BoardTab,
  EngagementDetail,
  ReceiptDetail,
} from "@shared/pa-views";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { loadDemoData, useDemoMode } from "@/lib/demo-mode";

/**
 * The workspace access check runs on every request and fails closed when
 * Dispatch is slow (D74), which reads as "You do not have access". It is
 * almost always a blip, so retry it a few times before showing the error.
 */
const TRANSIENT =
  /do not have access to this workspace app|unauthorized|timed out|failed to fetch|network|502|503|504/i;
export function transientRetry(failureCount: number, error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return failureCount < 3 && TRANSIENT.test(message);
}
const retryDelay = (attempt: number) => Math.min(1000 * 2 ** attempt, 4000);

export function useInboundBoard(tab: BoardTab, state: string | undefined) {
  const demo = useDemoMode();
  const live = useActionQuery<BoardResult, "list-inbound">(
    "list-inbound",
    state ? { tab, state } : { tab },
    {
      placeholderData: keepPreviousData,
      enabled: !demo,
      retry: transientRetry,
      retryDelay,
      // HubSpot is polled every minute; refetch so new requests show up
      // at the top without a reload.
      refetchInterval: 30_000,
    },
  );
  const sample = useQuery({
    queryKey: ["pa-demo", "board", tab, state ?? null],
    queryFn: async () => (await loadDemoData()).board(tab, state ?? null),
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    enabled: demo,
  });
  return demo ? sample : live;
}

export function useEngagement(id: string) {
  const demo = isDemoId(id);
  const live = useActionQuery<EngagementDetail | null, "get-engagement">(
    "get-engagement",
    { id },
    { enabled: !demo, retry: transientRetry, retryDelay },
  );
  const sample = useQuery({
    queryKey: ["pa-demo", "engagement", id],
    queryFn: async () => (await loadDemoData()).engagement(id),
    staleTime: Infinity,
    enabled: demo,
  });
  return demo ? sample : live;
}

export function useReceipt(id: string) {
  const demo = isDemoId(id);
  const live = useActionQuery<ReceiptDetail | null, "get-receipt">(
    "get-receipt",
    { id },
    { enabled: !demo },
  );
  const sample = useQuery({
    queryKey: ["pa-demo", "receipt", id],
    queryFn: async () => (await loadDemoData()).receipt(id),
    staleTime: Infinity,
    enabled: demo,
  });
  return demo ? sample : live;
}
