// Who sends a lead's first touch and what became of it (D96). Pure reads,
// shared by the send step (server/lib/first-touch-send.ts) and the lead view.
import type { DeliveryView } from "../../../shared/pa-views.js";
import type {
  EngagementRecord,
  OutboxRecord,
  PaRepository,
} from "../repo/types.js";

/** Who sends this lead's first touch: its PA owner, else its HubSpot owner. */
export async function leadOwnerEmail(
  repository: PaRepository,
  engagement: EngagementRecord,
): Promise<string | null> {
  if (engagement.ownerUserId) {
    const profile = await repository.getProfile(engagement.ownerUserId);
    if (profile?.email) return profile.email.toLowerCase();
  }
  const receipts = await repository.listReceipts(engagement.id);
  const routing = [...receipts].reverse().find((item) => item.kind === "route")
    ?.ruleResults.routing as { owner?: { email?: string | null } } | undefined;
  return routing?.owner?.email?.toLowerCase() ?? null;
}

/** What the draft card shows after an approval: sent, or in Gmail Drafts. */
export function deliveryOf(rows: OutboxRecord[]): DeliveryView | null {
  const gmail = rows.filter(
    (row) => row.kind === "gmail_send" || row.kind === "gmail_draft",
  );
  const sent = gmail.find(
    (row) => row.kind === "gmail_send" && row.status !== "failed",
  );
  const row = sent ?? gmail[gmail.length - 1];
  if (!row) return null;
  const by = typeof row.payload.by === "string" ? row.payload.by : null;
  const draftId =
    typeof row.payload.draft_id === "string" ? row.payload.draft_id : null;
  return {
    kind:
      row.status === "failed"
        ? "failed"
        : row.status === "pending"
          ? "sending"
          : row.kind === "gmail_send"
            ? "sent"
            : "gmail_draft",
    draftId,
    by,
    at: row.updatedAt,
    error: row.lastError,
  };
}
