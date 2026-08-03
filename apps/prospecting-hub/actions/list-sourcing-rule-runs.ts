import { defineAction } from "@agent-native/core";
import { desc, eq } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { syncRecords } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

// Backing the "Recent runs" UI in lists.tsx's ListDetailView (Run History
// feature) — Fred's explicit ask after being confused watching an opaque
// "Find prospects now" run either succeed or time out with no visibility
// into what happened. Reads the sync_records rows run-sourcing-rule-pipeline.ts
// checkpoints throughout its own lifecycle (insert once as "running", then
// update the SAME row through search/scoring progress to its final
// success/failed state — see that action for the exact checkpoint points).
export default defineAction({
  description:
    "List the most recent sync_records runs for a given sourcing rule (its 'Recent runs' history), most recent first — includes in-flight 'running' rows (which may represent a genuinely still-running, or a since-timed-out, run) and their last-known progress checkpoint.",
  schema: z.object({ ruleId: z.string().min(1) }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ ruleId }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

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
      .where(eq(syncRecords.sourcingRuleId, ruleId))
      .orderBy(desc(syncRecords.startedAt))
      .limit(10);

    const runs = rows.map((row) => {
      // Defensive: a malformed metadata blob on any one row (old
      // pre-checkpoint rows never had this field at all; a future writer
      // bug could still corrupt it) must never break the whole list.
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
        // Older rows (written before this checkpoint instrumentation
        // shipped) won't have all — or any — of these; the UI must handle
        // each one being missing/undefined gracefully.
        imported: parsedMetadata.imported as number | undefined,
        scored: parsedMetadata.scored as number | undefined,
        deduped: parsedMetadata.deduped as number | undefined,
        scoringErrorCount: parsedMetadata.scoringErrorCount as number | undefined,
        companiesConsidered: parsedMetadata.companiesConsidered as number | undefined,
        icpQualifiedZeroCompanies: parsedMetadata.icpQualifiedZeroCompanies as boolean | undefined,
        phase: parsedMetadata.phase as string | undefined,
        recordsFound: parsedMetadata.recordsFound as number | undefined,
      };
    });

    return { runs };
  },
});
