import { getHubSpotToken, hubspotFetch } from "@xdr-hub/shared/server";

// Best-effort live HubSpot detail lookup for the contact drawer's HubSpot
// section — Fred's ask: "this should also give me hubspot information"
// (referencing his org's own custom contact/company properties: Global
// Region, CAE/EAE Level, ABX Program Type, QL Score, First/Recent
// Conversion, Last Program *, Contact/Company/xDR Owner, Lifecycle Stage,
// Recycle Reason, etc). Mirrors apps/li-agent/actions/check-hubspot-contact.ts's
// proven name+company fuzzy-match discipline for contacts that aren't yet
// linked to a HubSpot record (e.g. Prospector-sourced contacts) — Common
// Room/Prospector contacts have no HubSpot id to look up directly.
//
// Property labels are resolved dynamically against this portal's own live
// /crm/v3/properties definitions rather than hardcoded internal names,
// since these are custom, org-specific properties this app has no other
// way to know the internal name of — confirmed live against the real
// portal (fred@builder.io's HubSpot) that every label below resolves to
// a real property with these exact display labels. A label that doesn't
// exist is silently skipped — never an error, just one fewer field shown.

const CONTACT_LABELS = [
  "Contact owner",
  "Lifecycle Stage",
  "CAE/EAE Level Company",
  "QL Score - Contact",
  "First Conversion",
  "Time Last Seen",
  "Last Active in Builder App",
  "Recent Conversion",
  "Field Event",
  "Last Program Name",
  "Last Program Status",
  "Last Program Status Date",
  "Recycle Reason",
];

const COMPANY_LABELS = ["Global Region", "ABX Program Type", "Company Owner", "xDR Owner"];

export interface HubSpotContactField {
  label: string;
  value: string;
}

export interface HubSpotContactEnrichment {
  hubspotUrl: string | null;
  fields: HubSpotContactField[];
}

interface HubSpotPropertyDef {
  name: string;
  label: string;
  options?: Array<{ label: string; value: string }>;
}

async function fetchPropertyDefs(objectType: "contacts" | "companies"): Promise<HubSpotPropertyDef[]> {
  const res = (await hubspotFetch(`/crm/v3/properties/${objectType}`)) as { results?: HubSpotPropertyDef[] };
  return res.results ?? [];
}

// Resolves the requested display labels against a portal's live property
// definitions (case-insensitive exact match), returning only the ones that
// actually exist here, plus each property's enum option map (for rendering
// a human label instead of a raw internal enum value — e.g. lifecyclestage's
// stored "152478579" needs its option map to show as "QL").
function resolveLabels(
  labels: string[],
  defs: HubSpotPropertyDef[],
): Array<{ label: string; name: string; options?: Map<string, string> }> {
  const byLabel = new Map(defs.map((d) => [d.label.trim().toLowerCase(), d]));
  const resolved: Array<{ label: string; name: string; options?: Map<string, string> }> = [];
  for (const label of labels) {
    const def = byLabel.get(label.trim().toLowerCase());
    if (!def) continue;
    resolved.push({
      label,
      name: def.name,
      options: def.options ? new Map(def.options.map((o) => [o.value, o.label])) : undefined,
    });
  }
  return resolved;
}

// `hubspot_owner_id` is HubSpot's native "owner" property type on both
// contacts and companies — its enumeration `options` are auto-populated
// from the portal's current users but can lag behind a newly added owner
// (confirmed live: one real contact's owner id wasn't in the cached
// options list), so an unresolved id falls back to a direct owner lookup
// rather than showing a bare numeric id.
async function resolveOwnerValue(rawId: string, options?: Map<string, string>): Promise<string> {
  if (options?.has(rawId)) return options.get(rawId)!;
  try {
    const owner = (await hubspotFetch(`/crm/v3/owners/${rawId}`)) as { firstName?: string; lastName?: string; email?: string };
    return [owner.firstName, owner.lastName].filter(Boolean).join(" ") || owner.email || rawId;
  } catch {
    return rawId;
  }
}

function formatValue(raw: string, options?: Map<string, string>): string {
  if (options?.has(raw)) return options.get(raw)!;
  // HubSpot date/datetime properties come back as either an ISO date
  // string ("2026-07-30", "2026-07-30T15:39:00Z") or a millisecond epoch
  // string, depending on property/API version — confirmed both forms live.
  if (/^\d{4}-\d{2}-\d{2}/.test(raw) || /^\d{10,}$/.test(raw)) {
    const parsed = new Date(/^\d{10,}$/.test(raw) ? Number(raw) : raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  }
  return raw;
}

async function resolveField(name: string, raw: string, options?: Map<string, string>): Promise<string> {
  return name === "hubspot_owner_id" ? resolveOwnerValue(raw, options) : formatValue(raw, options);
}

async function findHubSpotContactId(input: {
  email: string | null;
  fullName: string;
  companyName: string | null;
}): Promise<string | null> {
  const { email, fullName, companyName } = input;

  if (email) {
    try {
      const res = (await hubspotFetch("/crm/v3/objects/contacts/search", {
        method: "POST",
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
          limit: 1,
        }),
      })) as { results?: Array<{ id: string }> };
      if (res.results?.[0]?.id) return res.results[0].id;
    } catch {
      // fall through to name+company matching below
    }
  }

  const nameParts = fullName.trim().split(/\s+/);
  const firstName = nameParts[0] ?? "";
  const lastName = nameParts.slice(1).join(" ").toLowerCase();
  const companyLower = (companyName ?? "").toLowerCase();
  if (!firstName) return null;

  const filterGroups: Array<{ filters: Array<{ propertyName: string; operator: string; value: string }> }> = [];
  if (lastName) {
    filterGroups.push({
      filters: [
        { propertyName: "firstname", operator: "EQ", value: firstName },
        { propertyName: "lastname", operator: "EQ", value: lastName },
      ],
    });
  }
  if (companyName) {
    filterGroups.push({
      filters: [
        { propertyName: "firstname", operator: "EQ", value: firstName },
        { propertyName: "company", operator: "CONTAINS_TOKEN", value: companyName },
      ],
    });
  }
  if (!filterGroups.length) {
    filterGroups.push({ filters: [{ propertyName: "firstname", operator: "EQ", value: firstName }] });
  }

  let results: Array<{ id: string; properties: Record<string, string> }> = [];
  try {
    const res = (await hubspotFetch("/crm/v3/objects/contacts/search", {
      method: "POST",
      body: JSON.stringify({
        filterGroups,
        properties: ["firstname", "lastname", "company"],
        limit: 10,
      }),
    })) as { results?: typeof results };
    results = res.results ?? [];
  } catch {
    return null;
  }

  const match =
    results.find(
      (r) => lastName && (r.properties.lastname ?? "").toLowerCase() === lastName && companyLower && (r.properties.company ?? "").toLowerCase() === companyLower,
    ) ??
    results.find((r) => lastName && (r.properties.lastname ?? "").toLowerCase() === lastName) ??
    results.find((r) => companyLower && (r.properties.company ?? "").toLowerCase() === companyLower) ??
    (results.length === 1 ? results[0] : undefined);

  return match?.id ?? null;
}

export async function lookupHubSpotContactDetail(input: {
  fullName: string;
  companyName: string | null;
  email: string | null;
  knownHubspotContactId: string | null;
}): Promise<HubSpotContactEnrichment | null> {
  const token = await getHubSpotToken();
  if (!token) return null;

  const contactId = input.knownHubspotContactId ?? (await findHubSpotContactId(input));
  if (!contactId) return null;

  const fields: HubSpotContactField[] = [];

  const contactDefs = await fetchPropertyDefs("contacts");
  const resolvedContactProps = resolveLabels(CONTACT_LABELS, contactDefs);

  const contactRes = (await hubspotFetch(
    `/crm/v3/objects/contacts/${contactId}?properties=${resolvedContactProps.map((r) => r.name).join(",")}`,
  )) as { properties?: Record<string, string | undefined> };
  const contactProps = contactRes.properties ?? {};

  for (const { label, name, options } of resolvedContactProps) {
    const raw = contactProps[name];
    if (!raw) continue;
    fields.push({ label, value: await resolveField(name, raw, options) });
  }

  // Associated company's rolled-up properties — best-effort, a missing
  // association or a company-side fetch failure just means fewer fields,
  // never a failed lookup for the contact fields already gathered above.
  try {
    const assocRes = (await hubspotFetch(`/crm/v4/objects/contacts/${contactId}/associations/companies`)) as {
      results?: Array<{ toObjectId?: string | number }>;
    };
    const companyId = assocRes.results?.[0]?.toObjectId;
    if (companyId != null) {
      const companyDefs = await fetchPropertyDefs("companies");
      const resolvedCompanyProps = resolveLabels(COMPANY_LABELS, companyDefs);
      if (resolvedCompanyProps.length > 0) {
        const companyRes = (await hubspotFetch(
          `/crm/v3/objects/companies/${companyId}?properties=${resolvedCompanyProps.map((r) => r.name).join(",")}`,
        )) as { properties?: Record<string, string | undefined> };
        const companyProps = companyRes.properties ?? {};
        for (const { label, name, options } of resolvedCompanyProps) {
          const raw = companyProps[name];
          if (!raw) continue;
          fields.push({ label: `${label} (Company)`, value: await resolveField(name, raw, options) });
        }
      }
    }
  } catch {
    // best-effort — contact-level fields above still stand
  }

  let hubspotUrl: string | null = null;
  try {
    const info = (await hubspotFetch("/account-info/v3/details")) as { portalId?: number };
    if (info.portalId) hubspotUrl = `https://app.hubspot.com/contacts/${info.portalId}/contact/${contactId}`;
  } catch {
    // best-effort
  }

  return { hubspotUrl, fields };
}
