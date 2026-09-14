import { notify } from "@agent-native/core/notifications";
import { listWorkspaceAdmins } from "@xdr-hub/shared/server";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb } from "../../db/index.js";
import { apolloCreditThresholdNotices } from "../../db/schema.js";
import type { BudgetState } from "./guard.js";

// Tells admins once per period when Apollo credits cross a threshold.
//
// Uses the framework's notification system, which is ALREADY wired: core's
// routes plugin calls registerBuiltinNotificationChannels() and mounts the
// notifications endpoints, so this needs no plugin registration of its own.

/**
 * `channels: ["inbox"]` is MANDATORY, not a default.
 *
 * registerBuiltinNotificationChannels() always registers webhook, Slack and
 * email channels, and they activate off environment variables
 * (NOTIFICATIONS_WEBHOOK_URL, NOTIFICATIONS_SLACK_WEBHOOK_URL,
 * NOTIFICATIONS_EMAIL_RECIPIENTS). Omitting this would mean that the moment
 * any of those is set for an unrelated reason, credit warnings start fanning
 * out to Slack and email -- which is not what was asked for, and is the kind
 * of surprise that is discovered by a channel filling up.
 */
const IN_APP_ONLY = ["inbox"];

function severityFor(threshold: number): "info" | "warning" | "critical" {
  if (threshold >= 100) return "critical";
  if (threshold >= 80) return "warning";
  return "info";
}

/**
 * Claims a (period, threshold) pair, returning true only for the caller that
 * won it.
 *
 * The composite natural key IS the primary key, so onConflictDoNothing is the
 * whole dedupe mechanism -- no read-then-write race between concurrent
 * serverless instances. The run-id comparison afterwards is what makes the
 * claim portable: affected-row counts are not reported consistently across
 * SQLite and Postgres, so we write a token and check whether ours survived.
 */
async function claimThreshold(
  periodStart: string,
  threshold: number,
  spentAtFire: number,
): Promise<boolean> {
  const db = getDb();
  const id = `${periodStart}|${threshold}`;
  const runId = nanoid();

  await db
    .insert(apolloCreditThresholdNotices)
    .values({ id, periodStart, threshold, spentAtFire, noticeRunId: runId, firedAt: new Date().toISOString() })
    .onConflictDoNothing();

  const [row] = await db
    .select({ noticeRunId: apolloCreditThresholdNotices.noticeRunId })
    .from(apolloCreditThresholdNotices)
    .where(eq(apolloCreditThresholdNotices.id, id))
    .limit(1);
  return row?.noticeRunId === runId;
}

/** Releases a claim, so an undelivered notice is retried rather than lost. */
async function releaseThreshold(periodStart: string, threshold: number): Promise<void> {
  await getDb()
    .delete(apolloCreditThresholdNotices)
    .where(eq(apolloCreditThresholdNotices.id, `${periodStart}|${threshold}`));
}

/**
 * Fires any newly-crossed threshold notification.
 *
 * Entirely best-effort: every path is wrapped, because a failed notification
 * must never fail the enrichment that triggered it. Called from
 * settleEnrichment (the only place guaranteed to run exactly when spend
 * changes, given this deployment has no reliable cron) and from
 * get-apollo-credit-usage (which catches a threshold crossed by a webhook
 * reconciliation, where no enrichment is in flight).
 */
export async function maybeNotifyCreditThresholds(state: BudgetState): Promise<void> {
  try {
    if (!state.enabled || state.budget <= 0) return;

    const crossed = state.settings.thresholds.filter((t) => state.spentPct >= t);
    if (crossed.length === 0) return;

    const admins = await listWorkspaceAdmins();
    // Do NOT claim a threshold we cannot deliver: an empty roles table would
    // otherwise burn the once-per-period token on a notice nobody received,
    // and it would never fire again even after someone is made admin.
    if (admins.length === 0) return;

    for (const threshold of crossed) {
      const won = await claimThreshold(state.period.key, threshold, state.spent).catch(() => false);
      if (!won) continue;

      const atLimit = threshold >= 100;
      const title = atLimit
        ? "Apollo credits are used up"
        : `Apollo credits ${threshold}% spent`;
      const body = atLimit
        ? `The workspace has spent its ${state.budget.toLocaleString()} Apollo credits for this period. Enrichment is paused until ${state.resetLabel}. Raise the budget in Settings if this is wrong.`
        : `${state.spent.toLocaleString()} of ${state.budget.toLocaleString()} credits used, ${state.remaining.toLocaleString()} left. Credits reset ${state.resetLabel}.` +
          (threshold >= state.settings.phoneStopPct
            ? " Phone reveals are now paused; email enrichment still works."
            : "");

      const results = await Promise.allSettled(
        admins.map((owner) =>
          notify(
            {
              severity: severityFor(threshold),
              title,
              body,
              channels: IN_APP_ONLY,
              metadata: {
                periodStart: state.period.key,
                periodEnd: state.period.endIso,
                threshold,
                spent: state.spent,
                budget: state.budget,
                link: "/li-agent/analytics#apollo-credits",
              },
            },
            { owner },
          ),
        ),
      );

      // If every delivery failed, give the claim back so the next spend
      // retries rather than the period silently going unannounced.
      if (results.every((r) => r.status === "rejected")) {
        await releaseThreshold(state.period.key, threshold).catch(() => {});
      }
    }
  } catch {
    // A notification is not part of the spend contract.
  }
}
