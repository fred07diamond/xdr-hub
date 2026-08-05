import { defineAction } from "@agent-native/core";
import { desc, eq } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { marketingRules, syncRecords } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

// Marketing-rule analog of list-sourcing-rule-runs.ts — backs the same
// "Recent runs" UI in lists.tsx's ListDetailView, reading the sync_records
// rows run-marketing-rule-pipeline.ts checkpoints throughout its lifecycle.
export default defineAction({
  description:
    "List the most recent sync_records runs for a given Marketing rule (its 'Recent runs' history), most recent first — includes in-flight 'running' rows and their last-known progress checkpoint.",
  schema: z.object({ ruleId: z.string().min(1) }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ ruleId }, ctx) => {
    const role = await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    // Row-level scoping, mirroring run-marketing-rule-pipeline.ts's own
    // ownership check — the role gate above only proves the caller is SOME
    // XDR/AE/admin, not that they're allowed to see THIS rule's run history.
    const ruleRows = await db
      .select({ id: marketingRules.id, ownerEmail: marketingRules.ownerEmail })
      .from(marketingRules)
      .where(eq(marketingRules.id, ruleId))
      .limit(1);
    const rule = ruleRows[0];
    if (!rule) {
      throw Object.assign(new Error(`Marketing rule ${ruleId} not found.`), { statusCode: 404 });
    }
    if (rule.ownerEmail !== ctx!.userEmail! && role !== "admin") {
      throw Object.assign(new Error("Only the marketing rule's owner or a manager can view this rule's run history."), {
        statusCode: 403,
      });
    }

    const rows = await db
      .select({
        id: syncRecords.id,
        source: syncRecords.source,
        status: syncRecords.status,
        startedAt: syncRecords.startedAt,
        completedAt: syncRecords.completedAt,
        recordsPulled: syncRecords.recordsPulled,
        error: syncRecords.error,
        metadata: syncRecords.metadata,
      })
      .from(syncRecords)
      .where(eq(syncRecords.marketingRuleId, ruleId))
      .orderBy(desc(syncRecords.startedAt))
      .limit(10);

    const runs = rows.map((row) => {
      let parsedMetadata: Record<string, unknown> = {};
      if (row.metadata) {
        try {
          const parsed = JSON.parse(row.metadata);
          if (parsed && typeof parsed === "object") parsedMetadata = parsed as Record<string, unknown>;
        } catch {
          parsedMetadata = {};
        }
      }

      return {
        id: row.id,
        source: row.source,
        status: row.status,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        recordsPulled: row.recordsPulled,
        error: row.error,
        imported: parsedMetadata.imported as number | undefined,
        scored: parsedMetadata.scored as number | undefined,
        deduped: parsedMetadata.deduped as number | undefined,
        alreadyKnown: parsedMetadata.alreadyKnown as number | undefined,
        scoringErrorCount: parsedMetadata.scoringErrorCount as number | undefined,
        phase: parsedMetadata.phase as string | undefined,
        recordsFound: parsedMetadata.recordsFound as number | undefined,
        // What this run actually filtered HubSpot for — the analog of the
        // Prospected pipeline's titleKeywords/seniorities.
        lifecycleStages: parsedMetadata.lifecycleStages as string[] | undefined,
      };
    });

    return { runs };
  },
});
