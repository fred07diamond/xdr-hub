// Sweep and feature flags arrive in M1 (D12, D34).
import { registerEvent } from "@agent-native/core/event-bus";
import { registerNotificationChannel } from "@agent-native/core/notifications";
import { z } from "zod";

import { activeRelease } from "../lib/pa-context.js";
import { slackDmChannel } from "../lib/slack-dm.js";

export default async (): Promise<void> => {
  // Suggestions reach Slack once PA_SLACK_BOT_TOKEN is set (D45).
  registerNotificationChannel(slackDmChannel);
  // Names the review automation's trigger. It is never emitted: the in-process
  // bus is not durable on serverless, so publish queues the run with
  // queueAutomationRunNow instead, and emitting would start a second run.
  registerEvent({
    name: "pa.playbook.published",
    description: "A playbook change was published as a new active release",
    payloadSchema: z.object({ changeId: z.string(), releaseId: z.string() }),
  });
  try {
    const release = await activeRelease();
    console.info(`[pa] Active playbook release ${release.short_id}`);
  } catch (error) {
    console.warn(
      "[pa] Active release lookup deferred to first use:",
      error instanceof Error ? error.message : error,
    );
  }
};
