import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { workspaceSettings } from "../server/db/schema.js";
import { APOLLO_SETTING_KEYS, VERDICT_BAR_VALUES } from "../server/helpers/apollo-credits/settings.js";
import { MAX_ANCHOR_DAY, MIN_ANCHOR_DAY } from "../server/helpers/apollo-credits/period.js";
import { requireAdmin } from "../server/helpers/require-admin.js";

// Admin write path for the Apollo credit knobs, mirroring set-daily-limit.ts
// (the established workspace_settings pattern in this app).
//
// Every field is optional so the Settings card can save one control without
// having to send, and therefore risk clobbering, the others.
export default defineAction({
  description:
    "Update Apollo credit governance settings: the master enrichment switch, the period budget and renewal day, the per-user default allowance, the phone-reveal pause threshold, the automatic sweep share, and the fit bars.",
  schema: z.object({
    enabled: z.boolean().nullish(),
    periodBudget: z.number().int().min(0).max(100_000_000).nullish(),
    anchorDay: z.number().int().min(MIN_ANCHOR_DAY).max(MAX_ANCHOR_DAY).nullish(),
    safetyMargin: z.number().int().min(0).max(100_000).nullish(),
    userDefaultLimit: z.number().int().min(0).max(100_000_000).nullish(),
    // Not 0: a phone-stop of 0 would block every reveal forever while looking
    // like a configuration value rather than an outage.
    phoneStopPct: z.number().int().min(1).max(100).nullish(),
    sweepReservePct: z.number().int().min(0).max(100).nullish(),
    enrichMinVerdict: z.enum(VERDICT_BAR_VALUES as unknown as [string, ...string[]]).nullish(),
    phoneMinVerdict: z.enum(VERDICT_BAR_VALUES as unknown as [string, ...string[]]).nullish(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  audit: {
    summary: (args) =>
      args.enabled === false
        ? "Apollo enrichment TURNED OFF"
        : args.enabled === true
          ? "Apollo enrichment turned on"
          : "Apollo credit settings updated",
  },
  run: async (input, ctx) => {
    await requireAdmin(ctx);
    const db = getDb();
    const now = new Date().toISOString();

    const writes: Array<{ key: string; value: string }> = [];
    const k = APOLLO_SETTING_KEYS;
    if (input.enabled != null) writes.push({ key: k.enabled, value: input.enabled ? "1" : "0" });
    if (input.periodBudget != null) writes.push({ key: k.periodBudget, value: String(input.periodBudget) });
    if (input.anchorDay != null) writes.push({ key: k.anchorDay, value: String(input.anchorDay) });
    if (input.safetyMargin != null) writes.push({ key: k.safetyMargin, value: String(input.safetyMargin) });
    if (input.userDefaultLimit != null) writes.push({ key: k.userDefaultLimit, value: String(input.userDefaultLimit) });
    if (input.phoneStopPct != null) writes.push({ key: k.phoneStopPct, value: String(input.phoneStopPct) });
    if (input.sweepReservePct != null) writes.push({ key: k.sweepReservePct, value: String(input.sweepReservePct) });
    if (input.enrichMinVerdict != null) writes.push({ key: k.enrichMinVerdict, value: input.enrichMinVerdict });
    if (input.phoneMinVerdict != null) writes.push({ key: k.phoneMinVerdict, value: input.phoneMinVerdict });

    if (writes.length === 0) return { ok: false as const, error: "Nothing to update." };

    for (const w of writes) {
      await db
        .insert(workspaceSettings)
        .values({ key: w.key, value: w.value, updatedAt: now })
        .onConflictDoUpdate({ target: workspaceSettings.key, set: { value: w.value, updatedAt: now } });
    }

    return { ok: true as const, updated: writes.map((w) => w.key) };
  },
});
