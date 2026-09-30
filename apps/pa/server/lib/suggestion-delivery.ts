// Delivers new suggestions to their audience (D44): the in-app inbox and bell
// through notify(), and Slack DMs through the pa-slack-dm channel (D45).
// Docs: notifications#notify, notifications#register.
import { notify } from "@agent-native/core/notifications";
import { listWorkspaceAdmins } from "@xdr-hub/shared/server";

import type { PaRepository, SuggestionRecord } from "../core/repo/types.js";
import { membersOf } from "./pa-roles.js";

async function recipients(
  suggestion: SuggestionRecord,
  orgId: string | null,
): Promise<string[]> {
  if (suggestion.audience === "app_owner")
    return (await listWorkspaceAdmins()).map((email) => email.toLowerCase());
  const members = await membersOf(suggestion.audience, orgId);
  // Nobody on the team yet: the app owner hears about it instead.
  return members.length > 0
    ? members
    : (await listWorkspaceAdmins()).map((email) => email.toLowerCase());
}

export async function deliverSuggestions(
  repo: PaRepository,
  suggestions: SuggestionRecord[],
  orgId: string | null,
  now: () => Date,
) {
  const profiles = await repo.listProfiles();
  for (const suggestion of suggestions) {
    try {
      for (const email of await recipients(suggestion, orgId)) {
        await notify(
          {
            severity: suggestion.kind === "crm_field" ? "warning" : "info",
            title: suggestion.title,
            body: suggestion.body,
            metadata: {
              paSuggestion: true,
              suggestionId: suggestion.id,
              kind: suggestion.kind,
              url: "/pa/suggestions",
              orgId,
              slackUserId:
                profiles.find((profile) => profile.email === email)
                  ?.slackUserId ?? null,
            },
          },
          { owner: email },
        );
      }
      await repo.updateSuggestion(
        suggestion.id,
        { notifiedAt: now().toISOString() },
        suggestion.version,
      );
    } catch (error) {
      // Delivery is best effort: the suggestion is saved and shows in the inbox.
      console.warn(
        "[pa] Suggestion delivery failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }
}
