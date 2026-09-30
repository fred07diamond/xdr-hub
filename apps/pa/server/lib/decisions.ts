// Decision loop wiring (D59): creating decisions for live leads, and the
// deadline check the minute poll runs. A missed deadline is recorded and
// alerted; the recommendation is never executed (Fred, 2026-09-30).
import { notify } from "@agent-native/core/notifications";

import {
  CHOICE_LABELS,
  ensureDecision,
  markMissedDeadlines,
  type Choice,
} from "../core/decisions/index.js";
import { activeRelease, newId, now, repo } from "./pa-context.js";

export async function decisionDeps() {
  return { repo: repo(), release: await activeRelease(), now, newId };
}

export async function ensureDecisionFor(
  engagementId: string,
  options: { dueFrom?: "submission" | "now" } = {},
) {
  return ensureDecision(await decisionDeps(), engagementId, options);
}

export async function checkDecisionDeadlines(owner: {
  userEmail: string;
  orgId?: string;
}) {
  const missed = await markMissedDeadlines(await decisionDeps());
  for (const decision of missed) {
    const recipients = new Set(
      [decision.ownerEmail, owner.userEmail].filter((email): email is string =>
        Boolean(email),
      ),
    );
    for (const email of recipients) {
      try {
        await notify(
          {
            severity: "warning",
            title: "A lead decision is past its 24 hour SLA",
            body: `PA recommended: ${CHOICE_LABELS[decision.recommendation as Choice] ?? decision.recommendation}. Nothing was executed; the rep still decides.`,
            metadata: {
              paDecision: true,
              engagementId: decision.engagementId,
              url: `/pa/inbound/${decision.engagementId}`,
              orgId: owner.orgId ?? null,
            },
          },
          { owner: email },
        );
      } catch (error) {
        console.warn(
          "[pa] Deadline alert failed:",
          error instanceof Error ? error.message : error,
        );
      }
    }
  }
  return { missed: missed.length };
}
