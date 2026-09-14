import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { workspaceSettings } from "../server/db/schema.js";
import {
  getLeadScoringSettings,
  HOT_LEAD_SETTING_KEYS,
} from "../server/helpers/lead-scoring-settings.js";
import { requireAdmin } from "../server/helpers/require-admin.js";

export default defineAction({
  description: "Update the thresholds that decide which leads appear in the highlighted (hot) leads section.",
  schema: z.object({
    // Floor of 1, not 0: a threshold of 0 would make every scored lead hot,
    // which looks identical to the feature being broken.
    scoreThreshold: z.number().int().min(1).max(100).nullish(),
    intentWindowDays: z.number().int().min(1).max(365).nullish(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  audit: { summary: () => "Highlighted-lead thresholds updated" },
  run: async (input, ctx) => {
    await requireAdmin(ctx);
    const db = getDb();
    const now = new Date().toISOString();

    const writes: Array<{ key: string; value: string }> = [];
    if (input.scoreThreshold != null) {
      writes.push({ key: HOT_LEAD_SETTING_KEYS.scoreThreshold, value: String(input.scoreThreshold) });
    }
    if (input.intentWindowDays != null) {
      writes.push({ key: HOT_LEAD_SETTING_KEYS.intentWindowDays, value: String(input.intentWindowDays) });
    }
    if (writes.length === 0) return { ok: false as const, error: "Nothing to update." };

    for (const w of writes) {
      await db
        .insert(workspaceSettings)
        .values({ key: w.key, value: w.value, updatedAt: now })
        .onConflictDoUpdate({ target: workspaceSettings.key, set: { value: w.value, updatedAt: now } });
    }

    // Read back, same as set-apollo-credit-settings: the form seeds from what
    // was actually stored rather than from a cache that was never refetched.
    return { ok: true as const, settings: await getLeadScoringSettings() };
  },
});
