import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadListItems, prospects, workspaceSettings } from "../server/db/schema.js";
import { pickPersonalPhoneNumber } from "../server/helpers/apollo-client.js";

// Apollo POSTs here asynchronously after a reveal_phone_number request
// (see matchApolloPerson's revealPhone option). The exact payload shape
// isn't fully documented -- these paths are a reasoned best guess pending
// live confirmation from a real callback, same discipline as the Sales Nav
// DOM selectors: ship it, correct precisely once a real payload is seen.
function findRequestId(body: Record<string, unknown>): string | null {
  const candidates = [body.request_id, (body as any).requestId, (body.person as any)?.request_id];
  for (const c of candidates) {
    if (c !== undefined && c !== null) return String(c);
  }
  return null;
}

function findPhoneNumbers(body: Record<string, unknown>): Array<{ raw_number?: string; type?: string }> {
  const b = body as any;
  return b.phone_numbers ?? b.person?.phone_numbers ?? b.person?.contact?.phone_numbers ?? b.contact?.phone_numbers ?? [];
}

export default defineAction({
  description:
    "Receives Apollo's async phone-reveal webhook callback (reveal_phone_number flow) and stores the revealed personal number against whichever lead-list item or prospect requested it, matched by Apollo's request_id.",
  schema: z.object({}).passthrough(),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: false, requiresAuth: false },
  http: { method: "POST" },
  run: async (body) => {
    // TEMPORARY -- capture every raw payload Apollo actually sends so the
    // best-guess parsing above can be corrected from real data. Remove once
    // confirmed working.
    try {
      await getDb()
        .insert(workspaceSettings)
        .values({ key: "debug_last_apollo_webhook_payload", value: JSON.stringify(body).slice(0, 8000), updatedAt: new Date().toISOString() })
        .onConflictDoUpdate({
          target: workspaceSettings.key,
          set: { value: JSON.stringify(body).slice(0, 8000), updatedAt: new Date().toISOString() },
        });
    } catch {
      // best-effort -- never let debug capture block the real webhook handling
    }

    const requestId = findRequestId(body as Record<string, unknown>);
    // No request_id to match on -- ack anyway (200) so Apollo doesn't keep
    // retrying a payload we can never resolve.
    if (!requestId) return { ok: true };

    const phone = pickPersonalPhoneNumber(findPhoneNumbers(body as Record<string, unknown>));
    const now = new Date().toISOString();

    const db = getDb();

    const [listItem] = await db
      .select({ id: leadListItems.id })
      .from(leadListItems)
      .where(eq(leadListItems.phoneRevealRequestId, requestId))
      .limit(1);
    if (listItem) {
      if (phone) {
        await db
          .update(leadListItems)
          .set({ enrichedPhone: phone, phoneRevealStatus: "done", updatedAt: now })
          .where(eq(leadListItems.id, listItem.id));
      } else {
        await db
          .update(leadListItems)
          .set({ phoneRevealStatus: "no_match", updatedAt: now })
          .where(eq(leadListItems.id, listItem.id));
      }
      return { ok: true };
    }

    const [prospectRow] = await db
      .select({ id: prospects.id })
      .from(prospects)
      .where(eq(prospects.phoneRevealRequestId, requestId))
      .limit(1);
    if (prospectRow) {
      if (phone) {
        await db
          .update(prospects)
          .set({ enrichedPhone: phone, phoneRevealStatus: "done", updatedAt: now })
          .where(eq(prospects.id, prospectRow.id));
      } else {
        await db
          .update(prospects)
          .set({ phoneRevealStatus: "no_match", updatedAt: now })
          .where(eq(prospects.id, prospectRow.id));
      }
    }

    return { ok: true };
  },
});
