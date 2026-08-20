import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadListItems, prospects, workspaceSettings } from "../server/db/schema.js";
import { pickPersonalPhoneNumber } from "../server/helpers/apollo-client.js";

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

    const db = getDb();
    const now = new Date().toISOString();

    for (const { apolloPersonId, phone } of revealed) {
      const [listItem] = await db
        .select({ id: leadListItems.id })
        .from(leadListItems)
        .where(eq(leadListItems.phoneRevealRequestId, apolloPersonId))
        .limit(1);
      if (listItem) {
        if (phone) {
          await db
            .update(leadListItems)
            .set({ enrichedPhone: phone, phoneRevealStatus: "done", enrichmentSource: "apollo_phone_reveal", updatedAt: now })
            .where(eq(leadListItems.id, listItem.id));
        } else {
          await db
            .update(leadListItems)
            .set({ phoneRevealStatus: "no_match", updatedAt: now })
            .where(eq(leadListItems.id, listItem.id));
        }
        continue;
      }

      const [prospectRow] = await db
        .select({ id: prospects.id })
        .from(prospects)
        .where(eq(prospects.phoneRevealRequestId, apolloPersonId))
        .limit(1);
      if (prospectRow) {
        if (phone) {
          await db
            .update(prospects)
            .set({ enrichedPhone: phone, phoneRevealStatus: "done", enrichmentSource: "apollo_phone_reveal", updatedAt: now })
            .where(eq(prospects.id, prospectRow.id));
        } else {
          await db
            .update(prospects)
            .set({ phoneRevealStatus: "no_match", updatedAt: now })
            .where(eq(prospects.id, prospectRow.id));
        }
      }
    }

    return { ok: true };
  },
});
