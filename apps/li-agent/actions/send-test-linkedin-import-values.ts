import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { hubspotFetch } from "@xdr-hub/shared/server";

// TEMPORARY -- proves the linkedin_app_last_imported_by / linkedin_app_last_imported
// mapping actually works against real HubSpot field types before any real
// integration code is written. Writes to a dedicated, clearly-named test
// contact rather than touching a real one. Safe to delete once the real
// integration ships.
const TEST_CONTACT_EMAIL = "li-agent-integration-test@builder.io";

interface HubSpotContact {
  id: string;
}

async function findOrCreateTestContact(): Promise<{ id: string; created: boolean }> {
  const search = (await hubspotFetch("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: TEST_CONTACT_EMAIL }] }],
      limit: 1,
    }),
  })) as { results?: HubSpotContact[] };
  if (search.results?.[0]) return { id: search.results[0].id, created: false };

  const created = (await hubspotFetch("/crm/v3/objects/contacts", {
    method: "POST",
    body: JSON.stringify({
      properties: {
        email: TEST_CONTACT_EMAIL,
        firstname: "LI Agent",
        lastname: "Integration Test",
      },
    }),
  })) as HubSpotContact;
  return { id: created.id, created: true };
}

interface WriteResult {
  ok: boolean;
  error?: string;
}

async function tryPatch(contactId: string, properties: Record<string, string>): Promise<WriteResult> {
  try {
    await hubspotFetch(`/crm/v3/objects/contacts/${contactId}`, {
      method: "PATCH",
      body: JSON.stringify({ properties }),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export default defineAction({
  description:
    "Send test values for linkedin_app_last_imported_by / linkedin_app_last_imported to a dedicated test HubSpot contact, to confirm the field mapping works.",
  schema: z.object({}),
  requiresAuth: true,
  run: async (_args, ctx) => {
    const { id: contactId, created } = await findOrCreateTestContact();

    // linkedin_app_last_imported is fieldType "date" (date-only), which HubSpot
    // requires as midnight UTC in epoch milliseconds -- a real timestamp with a
    // time-of-day component gets rejected (PROPERTY_DOESNT_ALLOW_TIME).
    const now = new Date();
    const midnightUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

    // Sent as two separate PATCHes -- HubSpot validates a contact update's
    // properties object atomically, so bundling both into one call would let
    // the (currently guaranteed-invalid) enum value fail the whole request
    // and hide whether the date field mapping is actually correct.
    const dateResult = await tryPatch(contactId, {
      linkedin_app_last_imported: String(midnightUtcMs),
    });
    const byResult = await tryPatch(contactId, {
      // ctx.userEmail as a literal string value -- expected to fail today
      // since linkedin_app_last_imported_by has zero dropdown options.
      linkedin_app_last_imported_by: ctx?.userEmail ?? "test@builder.io",
    });

    return {
      ok: true as const,
      contactId,
      contactCreated: created,
      testContactEmail: TEST_CONTACT_EMAIL,
      linkedin_app_last_imported: dateResult,
      linkedin_app_last_imported_by: byResult,
    };
  },
});
