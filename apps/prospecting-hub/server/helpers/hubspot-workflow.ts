import { hubspotFetchWithTimeout } from "@xdr-hub/shared/server";

// HubSpot workflow ("flow") enrollment for pull-plan-sourced contacts.
// There is no stored persona-to-workflow mapping anywhere in this app --
// per Fred's explicit direction, the workflows already exist in HubSpot with
// a fixed naming convention (confirmed live: "((ENG - COMMONROOM)) Eng
// Persona - xDR Add to Hubspot Workflow", one per persona), so resolution is
// a name lookup against HubSpot's own flow list, done fresh on every
// reconcile tick rather than cached, so a renamed/new workflow is picked up
// automatically.

interface HubSpotFlow {
  id: string;
  name?: string;
}

interface ListFlowsResponse {
  // HubSpot's own docs: the LIST endpoint only returns key fields --
  // id/isEnabled/objectTypeId/revisionId -- NOT name. Confirmed live: every
  // result here came back with `name` undefined. Getting a flow's name
  // requires a second GET per flow id (/automation/v4/flows/{flowId}).
  results?: Array<{ id: string }>;
  paging?: { next?: { after?: string } };
}

interface FlowDetail {
  id: string;
  name?: string;
}

async function listFlowIds(): Promise<string[]> {
  const ids: string[] = [];
  let after: string | undefined;
  // Bounded to a few pages -- a portal with an unreasonable number of flows
  // would otherwise risk this call alone blowing the reconcile job's own
  // time budget; 500 flows (5 pages @ 100) is far beyond anything this
  // workspace actually has.
  for (let page = 0; page < 5; page++) {
    const query = after ? `?limit=100&after=${encodeURIComponent(after)}` : "?limit=100";
    const res = (await hubspotFetchWithTimeout(`/automation/v4/flows${query}`)) as ListFlowsResponse;
    ids.push(...(res.results ?? []).map((r) => r.id));
    after = res.paging?.next?.after;
    if (!after) break;
  }
  return ids;
}

// Fetches each flow's full detail (including name) in small concurrent
// batches -- the list endpoint's own response has no name field at all, so
// this second round-trip per flow is unavoidable to match by persona name.
// A failed individual detail fetch is skipped (name stays undefined, so it
// simply never matches) rather than failing the whole lookup over one bad
// flow id.
async function fetchFlowDetails(ids: string[]): Promise<FlowDetail[]> {
  const BATCH_SIZE = 10;
  const details: FlowDetail[] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (id) => {
        try {
          const flow = (await hubspotFetchWithTimeout(`/automation/v4/flows/${id}`)) as { id: string; name?: string };
          return { id, name: flow.name };
        } catch {
          return { id, name: undefined };
        }
      }),
    );
    details.push(...results);
  }
  return details;
}

export async function listHubSpotFlows(): Promise<HubSpotFlow[]> {
  const ids = await listFlowIds();
  return fetchFlowDetails(ids);
}

// Never guesses: exactly one case-insensitive match on both "commonroom" and
// "<personaName> persona" is required, or this throws with the ambiguity
// spelled out -- silently picking a workflow (or none) would mean real
// prospects get enrolled into the wrong live marketing automation, or
// silently never enrolled at all. Takes an already-fetched flow list so a
// caller enrolling multiple personas in one tick (reconcile-prospect-pull-
// plan.ts) only lists flows once, not once per persona.
export function matchWorkflowForPersona(flows: HubSpotFlow[], personaName: string): string {
  const needle = `${personaName.toLowerCase()} persona`;
  const matches = flows.filter((f) => {
    const name = f.name?.toLowerCase() ?? "";
    return name.includes("commonroom") && name.includes(needle);
  });

  if (matches.length === 0) {
    // Self-diagnosing on purpose: this is the exact spot that broke once
    // already (the list endpoint's missing `name` field made every match
    // fail silently) -- surfacing what was actually fetched turns "no
    // matching workflow" from a dead end into an immediate diagnosis.
    const sample = flows.slice(0, 10).map((f) => f.name ?? "(unnamed)");
    throw new Error(
      `No HubSpot workflow found matching persona "${personaName}" (looked for a flow name containing "commonroom" and "${needle}"). ` +
        `Fetched ${flows.length} workflow(s) total${sample.length > 0 ? `, e.g.: ${sample.join(" | ")}` : " (none returned at all)"}.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `${matches.length} HubSpot workflows match persona "${personaName}" (${matches.map((f) => f.name).join(", ")}) — cannot pick one automatically.`,
    );
  }
  return matches[0].id;
}

export async function findWorkflowIdForPersona(personaName: string): Promise<string> {
  const flows = await listHubSpotFlows();
  return matchWorkflowForPersona(flows, personaName);
}

export async function upsertHubSpotContact(input: {
  email: string | null;
  fullName: string;
  company: string | null;
  title: string | null;
}): Promise<string> {
  const nameParts = input.fullName.trim().split(/\s+/);
  const firstname = nameParts[0] ?? "";
  const lastname = nameParts.slice(1).join(" ");

  const properties: Record<string, string> = {
    firstname,
    ...(lastname ? { lastname } : {}),
    ...(input.company ? { company: input.company } : {}),
    ...(input.title ? { jobtitle: input.title } : {}),
    ...(input.email ? { email: input.email } : {}),
  };

  // With an email, HubSpot's default contact-create dedup key applies --
  // re-running this for the same person is safe. Without one (CommonRoom
  // didn't have it), this creates a new contact with no natural dedup key
  // each time it's called -- acceptable per Fred's explicit call ("if there
  // are folks without an email we can still send them through"), so this is
  // only ever called once per contact (contacts.hubspotContactId gates it).
  const created = (await hubspotFetchWithTimeout("/crm/v3/objects/contacts", {
    method: "POST",
    body: JSON.stringify({ properties }),
  })) as { id: string };
  return created.id;
}

// Requires the app's stored HubSpot Private App token to have the
// automation/workflows scope -- a 403 here means that scope needs adding to
// the token in HubSpot, not a bug in this call.
export async function enrollContactInFlow(flowId: string, hubspotContactId: string): Promise<void> {
  await hubspotFetchWithTimeout(`/automation/v4/flows/${flowId}/enrollments`, {
    method: "POST",
    body: JSON.stringify({ objectId: Number(hubspotContactId) }),
  });
}
