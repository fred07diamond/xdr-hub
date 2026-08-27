import { defineAction } from "@agent-native/core";
import { hubspotFetchWithTimeout } from "@xdr-hub/shared/server";
import { z } from "zod";
import { requireRole } from "../server/helpers/require-role.js";

// Temporary diagnostic — not part of any product flow. HubSpot's own
// token-introspection endpoint (GET /oauth/v1/access-tokens/{token}) turned
// out to be OAuth-only -- it rejects Private App (pat-) tokens outright with
// "must have the correct format", and HubSpot has no equivalent scope
// listing API for Private Apps (confirmed: the Auth tab in the Private App's
// own settings UI is the only place to see its scopes). So instead of
// introspecting, this just tries the two real operations under discussion
// and reports whether each one actually works. Delete once the
// automation-vs-crm.lists.write question is settled.
async function tryCall(label: string, call: () => Promise<unknown>): Promise<{ ok: boolean; detail: string }> {
  try {
    await call();
    return { ok: true, detail: `${label}: succeeded` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export default defineAction({
  description: "Test whether the configured HubSpot token can actually call the Automation and Lists APIs.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_input, ctx) => {
    try {
      await requireRole(ctx?.userEmail, ["admin"]);
    } catch (err) {
      return { stage: "requireRole", error: err instanceof Error ? err.message : String(err) };
    }

    const automation = await tryCall("automation (list workflows)", () =>
      hubspotFetchWithTimeout("/automation/v4/flows?limit=1"),
    );
    // Harmless read-only call — searching lists with no query returns
    // everything, same call this app would need to resolve a list by name
    // before adding a contact to it.
    const lists = await tryCall("crm.lists (search lists)", () =>
      hubspotFetchWithTimeout("/crm/v3/lists/search", { method: "POST", body: JSON.stringify({ count: 1 }) }),
    );

    return {
      canListWorkflows: automation.ok,
      automationDetail: automation.detail,
      canSearchLists: lists.ok,
      listsDetail: lists.detail,
    };
  },
});
