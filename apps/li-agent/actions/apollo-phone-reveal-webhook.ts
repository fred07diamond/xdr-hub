import { defineAction } from "@agent-native/core";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadListItems, prospects, workspaceSettings } from "../server/db/schema.js";
import { pickPersonalPhoneNumber } from "../server/helpers/apollo-client.js";
import {
  claimWebhookDelivery,
  reconcileRevealCredits,
} from "../server/helpers/apollo-credits/ledger.js";

// Apollo POSTs here asynchronously after a reveal_phone_number request (see
// matchApolloPerson's revealPhone option). Live-confirmed real payload
// shape -- there is NO request_id anywhere in it, despite Apollo's docs
// suggesting a request_id/webhook_result round-trip. Instead: a top-level
// `people` array, one entry per revealed person, each with Apollo's own
// person `id` (the same id ApolloPersonMatch.id returns from the
// synchronous match call -- that's the actual matching key) and a
// `phone_numbers` array whose type field is `type_cd`, NOT `type` like the
// synchronous /people/match response uses.
//
// Example real payload:
// {
//   "status": "success", "credits_consumed": 8,
//   "people": [{ "id": "...", "status": "success", "phone_numbers": [
//     { "raw_number": "+1 602-953-7531", "type_cd": "mobile", "status_cd": "valid_number", ... }
//   ]}]
// }
function findRevealedPeople(body: Record<string, unknown>): Array<{ apolloPersonId: string; phone: string | null }> {
  const people = (body as any)?.people;
  if (!Array.isArray(people)) return [];
  return people
    .map((p: any) => {
      const apolloPersonId = p?.id != null ? String(p.id) : null;
      if (!apolloPersonId) return null;
      const numbers = (p?.phone_numbers ?? []).map((n: any) => ({ raw_number: n?.raw_number, type: n?.type ?? n?.type_cd }));
      return { apolloPersonId, phone: pickPersonalPhoneNumber(numbers) };
    })
    .filter((p: unknown): p is { apolloPersonId: string; phone: string | null } => p !== null);
}

export default defineAction({
  description:
    "Receives Apollo's async phone-reveal webhook callback (reveal_phone_number flow) and stores the revealed personal number against whichever lead-list item or prospect requested it, matched by Apollo's own person id.",
  schema: z.object({}).passthrough(),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: false, requiresAuth: false },
  http: { method: "POST" },
  run: async (body) => {
    // TEMPORARY -- capture every raw payload Apollo actually sends, so any
    // further shape surprises can be corrected from real data. Remove once
    // this flow has run cleanly for a while.
    try {
      const raw = JSON.stringify(body).slice(0, 8000);
      await getDb()
        .insert(workspaceSettings)
        .values({ key: "debug_last_apollo_webhook_payload", value: raw, updatedAt: new Date().toISOString() })
        .onConflictDoUpdate({
          target: workspaceSettings.key,
          set: { value: raw, updatedAt: new Date().toISOString() },
        });
    } catch {
      // best-effort -- never let debug capture block real webhook handling
    }

    const revealed = findRevealedPeople(body as Record<string, unknown>);
    // Nothing we can match -- ack anyway (200) so Apollo doesn't keep
    // retrying a payload we can never resolve.
    if (revealed.length === 0) return { ok: true };

    // Apollo's own cost for this delivery, top-level in the payload. Split
    // across the people it covers, remainder on the first, because a payload
    // can in principle carry several (every observed one has carried exactly
    // one). UNTRUSTED -- this endpoint is unauthenticated, so the value is
    // clamped per-reveal downstream; see MAX_RECONCILED_REVEAL_CREDITS.
    const rawCredits = (body as { credits_consumed?: unknown })?.credits_consumed;
    const totalCredits = typeof rawCredits === "number" && Number.isFinite(rawCredits) ? rawCredits : null;
    const perPerson = totalCredits == null ? null : Math.floor(totalCredits / revealed.length);
    const remainder = totalCredits == null ? 0 : totalCredits - perPerson! * revealed.length;

    // Idempotency FIRST, before any write. Apollo delivers at-least-once; the
    // phone-number write below happens to be idempotent by accident (same
    // value written twice), but credit reconciliation is not -- a redelivery
    // would reconcile the same reveal again.
    const deliveryId = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const isNewDelivery = await claimWebhookDelivery(
      deliveryId,
      totalCredits,
      revealed.map((r) => r.apolloPersonId),
    ).catch(() => true); // bookkeeping failure must not drop a real callback
    if (!isNewDelivery) return { ok: true, duplicate: true };

    const db = getDb();
    const now = new Date().toISOString();

    for (const [index, { apolloPersonId, phone }] of revealed.entries()) {
      const phoneValues = phone
        ? { enrichedPhone: phone, phoneRevealStatus: "done" as const, enrichmentSource: "apollo_phone_reveal" as const, updatedAt: now }
        : { phoneRevealStatus: "no_match" as const, updatedAt: now };

      // Update BOTH tables, not whichever matched first.
      //
      // The previous version `continue`d after a lead_list_items hit, so a
      // lead that had since been promoted never got the number on its
      // prospects row -- and the Prospects page is where the number is
      // actually read. score-lead-list-item.ts copies phoneRevealRequestId
      // onto the promoted row, so the same Apollo person id legitimately
      // exists on both and both are the same person's reveal.
      const [listItem] = await db
        .select({ id: leadListItems.id })
        .from(leadListItems)
        .where(eq(leadListItems.phoneRevealRequestId, apolloPersonId))
        .limit(1);
      if (listItem) {
        await db.update(leadListItems).set(phoneValues).where(eq(leadListItems.id, listItem.id));
      }

      const [prospectRow] = await db
        .select({ id: prospects.id })
        .from(prospects)
        .where(eq(prospects.phoneRevealRequestId, apolloPersonId))
        .limit(1);
      if (prospectRow) {
        await db.update(prospects).set(phoneValues).where(eq(prospects.id, prospectRow.id));
      }

      // Apply Apollo's authoritative cost to the 8-credit reservation this
      // reveal created. Matched against the LEDGER rather than the record,
      // precisely because the person id can exist on two rows. Best-effort:
      // a bookkeeping failure must never make us 500 and have Apollo retry a
      // callback whose phone number we already stored.
      try {
        const credits = perPerson == null ? null : perPerson + (index === 0 ? remainder : 0);
        await reconcileRevealCredits(apolloPersonId, credits, phone ? "revealed" : "reveal_no_match");
      } catch {
        // ignored on purpose -- see above
      }
    }

    return { ok: true };
  },
});
