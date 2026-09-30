import { registerRequiredSecret } from "@agent-native/core/secrets";
import { defineNitroPlugin } from "@agent-native/core/server";

// The "PA Inbound" Slack app's bot token (D6, D45). Optional: without it,
// suggestions still reach people in the app, and Slack DMs are skipped.
export default defineNitroPlugin(() => {
  registerRequiredSecret({
    key: "PA_SLACK_BOT_TOKEN",
    label: "PA Inbound Slack bot token",
    description:
      "Sends playbook suggestions to the PA team, RevOps, and the app owner as Slack DMs.",
    docsUrl: "https://docs.slack.dev/authentication/tokens#bot",
    scope: "workspace",
    kind: "api-key",
    required: false,
  });
});
