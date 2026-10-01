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

export function useInboundBoard(tab: BoardTab, state: string | undefined) {
  const demo = useDemoMode();
  const live = useActionQuery<BoardResult, "list-inbound">(
    "list-inbound",
    state ? { tab, state } : { tab },
    {
      placeholderData: keepPreviousData,
      enabled: !demo,
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
    { enabled: !demo },
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
