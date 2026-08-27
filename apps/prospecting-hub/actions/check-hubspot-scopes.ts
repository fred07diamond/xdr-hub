import { defineAction } from "@agent-native/core";
import { hubspotFetchWithTimeout } from "@xdr-hub/shared/server";
import { z } from "zod";
import { requireRole } from "../server/helpers/require-role.js";

// Temporary diagnostic — not part of any product flow. There is no scope-
// listing API for HubSpot Private App tokens (confirmed: /oauth/v1/access-
// tokens/{token} is OAuth-only and rejects pat- tokens outright), so this
// tests every scope family this app could plausibly need by actually
// calling a representative endpoint for each and reporting pass/fail.
//
// WRITE scopes are tested with zero side effects: each write call targets a
// deliberately nonexistent object id (999999999999). HubSpot checks scope
// authorization BEFORE checking whether the object exists, so the response
// tells us which one failed:
//   - 404 Not Found  -> the scope IS present (request passed auth, object just doesn't exist)
//   - 403 Forbidden   -> the scope is MISSING (blocked before the object lookup)
// Delete this action once the scope picture is settled.

interface ScopeCheckResult {
  scope: string;
  ok: boolean;
  detail: string;
}

const FAKE_ID = "999999999999";

async function checkRead(scope: string, path: string): Promise<ScopeCheckResult> {
  try {
    await hubspotFetchWithTimeout(path);
    return { scope, ok: true, detail: "read succeeded" };
  } catch (err) {
    return { scope, ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

// See file header: a 404 on a fake id means the scope is present.
async function checkWriteAgainstFakeId(scope: string, path: string, body: unknown): Promise<ScopeCheckResult> {
  try {
    await hubspotFetchWithTimeout(path, { method: "PATCH", body: JSON.stringify(body) });
    // Genuinely unexpected (the fake id shouldn't exist) but still proves the scope works.
    return { scope, ok: true, detail: "write succeeded (unexpectedly matched a real object)" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("(404)")) {
      return { scope, ok: true, detail: "write scope present (404 on fake id — passed auth, object not found, as expected)" };
    }
    return { scope, ok: false, detail: message };
  }
}

export default defineAction({
  description: "Test every plausibly-relevant HubSpot scope family the configured token might have, using safe (no side-effect) calls.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: false, // write-scope checks make real (fake-id, 404-expected) PATCH calls
  http: { method: "GET" },
  run: async (_input, ctx) => {
    try {
      await requireRole(ctx?.userEmail, ["admin"]);
    } catch (err) {
      return { stage: "requireRole", error: err instanceof Error ? err.message : String(err) };
    }

    let portalId: number | null = null;
    try {
      const raw = (await hubspotFetchWithTimeout("/account-info/v3/details")) as { portalId?: number };
      portalId = raw?.portalId ?? null;
    } catch {
      // best-effort, ignore
    }

    const checks: Array<Promise<ScopeCheckResult>> = [
      checkRead("crm.objects.contacts.read", "/crm/v3/objects/contacts?limit=1"),
      checkWriteAgainstFakeId("crm.objects.contacts.write", `/crm/v3/objects/contacts/${FAKE_ID}`, { properties: {} }),
      checkRead("crm.objects.companies.read", "/crm/v3/objects/companies?limit=1"),
      checkWriteAgainstFakeId("crm.objects.companies.write", `/crm/v3/objects/companies/${FAKE_ID}`, { properties: {} }),
      checkRead("crm.objects.deals.read", "/crm/v3/objects/deals?limit=1"),
      checkWriteAgainstFakeId("crm.objects.deals.write", `/crm/v3/objects/deals/${FAKE_ID}`, { properties: {} }),
      checkRead("crm.objects.owners.read", "/crm/v3/owners?limit=1"),
      checkRead("crm.schemas.contacts.read (properties)", "/crm/v3/properties/contacts?limit=1"),
      checkRead("crm.schemas.companies.read (properties)", "/crm/v3/properties/companies?limit=1"),
      checkRead("automation (workflows)", "/automation/v4/flows?limit=1"),
      checkRead("tickets.read", "/crm/v3/objects/tickets?limit=1"),
      checkRead("marketing-email.read", "/marketing/v3/emails?limit=1"),
      (async (): Promise<ScopeCheckResult> => {
        try {
          await hubspotFetchWithTimeout("/crm/v3/lists/search", { method: "POST", body: JSON.stringify({ count: 1 }) });
          return { scope: "crm.lists.read", ok: true, detail: "read succeeded" };
        } catch (err) {
          return { scope: "crm.lists.read", ok: false, detail: err instanceof Error ? err.message : String(err) };
        }
      })(),
      checkWriteAgainstFakeId("crm.lists.write", `/crm/v3/lists/${FAKE_ID}/memberships/add`, [FAKE_ID]),
    ];

    const merged = await Promise.all(checks);

    return {
      portalId,
      present: merged.filter((r) => r.ok).map((r) => r.scope),
      missing: merged.filter((r) => !r.ok).map((r) => ({ scope: r.scope, detail: r.detail })),
      all: merged,
    };
  },
});
