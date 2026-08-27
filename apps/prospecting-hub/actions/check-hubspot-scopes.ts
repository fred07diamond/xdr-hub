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
  // NOT read-only -- the list-write check below creates a real (immediately
  // self-deleted) list to test crm.lists.write specifically, since read
  // access succeeding doesn't prove write access also does.
  readOnly: false,
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
    const listsRead = await tryCall("crm.lists (search lists)", () =>
      hubspotFetchWithTimeout("/crm/v3/lists/search", { method: "POST", body: JSON.stringify({ count: 1 }) }),
    );

    // Write test: create a throwaway list, then delete it immediately --
    // self-cleaning, leaves nothing behind either way. Read access succeeding
    // above does NOT prove write access also works, so this is a separate,
    // real test rather than an assumption.
    let listsWrite: { ok: boolean; detail: string };
    try {
      const created = (await hubspotFetchWithTimeout("/crm/v3/lists", {
        method: "POST",
        body: JSON.stringify({
          name: `claude-scope-test-DELETE-ME-${Date.now()}`,
          objectTypeId: "0-1",
          processingType: "MANUAL",
        }),
      })) as { list?: { listId?: string } };
      const listId = created.list?.listId;
      if (listId) {
        await hubspotFetchWithTimeout(`/crm/v3/lists/${listId}`, { method: "DELETE" });
      }
      listsWrite = { ok: true, detail: "crm.lists.write (create + delete test list): succeeded" };
    } catch (err) {
      listsWrite = { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }

    return {
      canListWorkflows: automation.ok,
      automationDetail: automation.detail,
      canSearchLists: listsRead.ok,
      listsReadDetail: listsRead.detail,
      canWriteLists: listsWrite.ok,
      listsWriteDetail: listsWrite.detail,
    };
  },
});
