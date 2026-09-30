// Slack DM channel for PA suggestions (D45): internal staff only, never leads.
// It sends through the separate "PA Inbound" Slack app (D6) and does nothing
// until its bot token is set, so it ships switched off.
// Slack docs: https://docs.slack.dev/reference/methods/users.lookupByEmail,
// https://docs.slack.dev/reference/methods/conversations.open,
// https://docs.slack.dev/reference/methods/chat.postMessage
import type { NotificationChannel } from "@agent-native/core/notifications";
import { readAppSecret } from "@agent-native/core/secrets";

const SLACK_API = "https://slack.com/api";
// notify() awaits every channel, so Slack must never hold up the caller.
const TIMEOUT_MS = 5_000;

async function slackToken(orgId: string | null): Promise<string | null> {
  if (orgId) {
    const stored = await readAppSecret({
      key: "PA_SLACK_BOT_TOKEN",
      scope: "workspace",
      scopeId: orgId,
    });
    if (stored?.value) return stored.value;
  }
  // guard:allow-env-credential — env fallback only when no vault-stored secret exists (single-workspace bootstrap and local dev), not a per-user credential
  return process.env.PA_SLACK_BOT_TOKEN ?? null;
}

/** Escapes Slack control characters so text never becomes a mention or link. */
export function escapeSlack(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function slack(
  token: string,
  method: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = (await response.json()) as {
    ok: boolean;
    error?: string;
  } & Record<string, unknown>;
  if (!data.ok)
    throw new Error(`Slack ${method} failed: ${data.error ?? response.status}`);
  return data;
}

async function lookupUser(token: string, email: string): Promise<string> {
  const url = `${SLACK_API}/users.lookupByEmail?email=${encodeURIComponent(email)}`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = (await response.json()) as {
    ok: boolean;
    error?: string;
    user?: { id: string };
  };
  if (!data.ok || !data.user)
    throw new Error(
      `Slack users.lookupByEmail failed: ${data.error ?? response.status}`,
    );
  return data.user.id;
}

export const slackDmChannel: NotificationChannel = {
  name: "pa-slack-dm",
  async deliver(input, meta) {
    const metadata = (input.metadata ?? {}) as {
      paSuggestion?: boolean;
      slackUserId?: string | null;
      orgId?: string | null;
      url?: string;
    };
    // Only PA's own suggestion notifications go to Slack.
    if (!metadata.paSuggestion) return false;
    const token = await slackToken(metadata.orgId ?? null);
    if (!token) return false;
    try {
      const user =
        metadata.slackUserId ?? (await lookupUser(token, meta.owner));
      const channel = (await slack(token, "conversations.open", {
        users: user,
      })) as { channel?: { id: string } };
      if (!channel.channel?.id) return false;
      const text =
        `${escapeSlack(input.title)}\n${escapeSlack(input.body ?? "")}`.trim();
      await slack(token, "chat.postMessage", {
        channel: channel.channel.id,
        text,
        unfurl_links: false,
        unfurl_media: false,
      });
      return true;
    } catch (error) {
      console.warn(
        "[pa] Slack DM skipped:",
        error instanceof Error ? error.message : error,
      );
      return false;
    }
  },
};
