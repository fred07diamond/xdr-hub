import { defineAction } from "@agent-native/core";
import { hubspotFetchIfConnected } from "@xdr-hub/shared/server";
import { z } from "zod";
import { requireRole } from "../server/helpers/require-role.js";

// Live-verified deviation from the original plan: `hubspot_owner_id` and
// `xdr_owner` are both HubSpot enumeration properties with
// `referencedObjectType: "OWNER"` / `externalOptions: true` — for that
// shape, GET /crm/v3/properties/companies/{name} genuinely returns
// `options: []` (confirmed live against this portal), NOT an inline
// {value,label} list as originally assumed. The real, current owner list
// for an externalOptions/OWNER property lives in HubSpot's own Owners API
// instead, so this fetches GET /crm/v3/owners (paginated) and returns every
// non-archived owner — any of them is a legal value for either property.
// Spot-checked live: id 77256344 -> "Fred Diamond", 78353286 -> "Adam
// Murray", 89066064 -> "Jason Yang", matching the sample pairs from the brief.
const PAGE_LIMIT = 100;
const MAX_PAGES = 20; // hard stop so a pathological paging loop can't run away

interface HubSpotOwner {
  id?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  archived?: boolean;
}

interface HubSpotOwnersResponse {
  results?: HubSpotOwner[];
  paging?: { next?: { after?: string } };
}

export default defineAction({
  description:
    "List the real HubSpot owners (people) an XDR can browse companies by, so the UI can offer a searchable owner picker for filtering companies by Company owner (hubspot_owner_id) or xDR Owner (xdr_owner) — both properties reference HubSpot's shared Owners list. Read-only. Returns an empty list (not an error) if HubSpot isn't connected — this only powers an optional browse picker.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_input, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);

    const byId = new Map<string, string>();
    let after: string | undefined;
    let page = 0;
    // Distinguishes "genuinely not connected" (accurate to tell the XDR to
    // connect HubSpot) from "connected, but a request actually failed"
    // (rate limit, expired token mid-session, transient 5xx) — these two
    // previously both surfaced as an identical empty/partial owner list with
    // no signal, so a real-but-broken connection told the XDR to do the
    // wrong troubleshooting step ("connect HubSpot") instead of the right
    // one ("something's wrong with the connection, try again").
    let fetchError: string | null = null;

    for (;;) {
      const path = after ? `/crm/v3/owners?limit=${PAGE_LIMIT}&after=${after}` : `/crm/v3/owners?limit=${PAGE_LIMIT}`;
      let connected: { token: string; data: unknown } | null;
      try {
        connected = await hubspotFetchIfConnected(path);
      } catch (err) {
        // A real, connected request failed mid-pagination — keep whatever
        // owners were already gathered (still useful for the picker) but
        // flag it so the UI shows an accurate message instead of "not
        // connected".
        fetchError = err instanceof Error ? err.message : String(err);
        break;
      }
      if (!connected) return { owners: [], notConnected: true }; // HubSpot genuinely not connected
      const parsed = connected.data as HubSpotOwnersResponse;
      for (const owner of parsed.results ?? []) {
        if (!owner.id || owner.archived) continue;
        const name = `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim() || owner.email || owner.id;
        byId.set(owner.id, name);
      }
      page++;
      after = parsed.paging?.next?.after;
      if (!after || page >= MAX_PAGES) break;
    }

    const owners = Array.from(byId.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { owners, notConnected: false, error: fetchError };
  },
});
