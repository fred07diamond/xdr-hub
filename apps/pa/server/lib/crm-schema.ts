// The portal schema snapshot (D48): read-only HubSpot property definitions,
// stored so the mapping editor and the checks never wait on HubSpot.
// HubSpot: https://developers.hubspot.com/docs/api/crm/properties
import { hubspotFetchWithTimeout } from "@xdr-hub/shared/server";

import type {
  CrmObject,
  PortalProperty,
  PortalSchema,
} from "../../shared/crm-mapping.js";
import { getDb, schema } from "../db/index.js";

export const CRM_OBJECTS: readonly CrmObject[] = [
  "contacts",
  "companies",
  "deals",
];

interface HubSpotProperty {
  name: string;
  label?: string;
  type?: string;
  fieldType?: string;
  groupName?: string;
  description?: string;
  options?: { label?: string; value?: string; hidden?: boolean }[];
  hubspotDefined?: boolean;
  calculated?: boolean;
  hidden?: boolean;
  archived?: boolean;
  referencedObjectType?: string;
  modificationMetadata?: { readOnlyValue?: boolean };
}

export function toPortalProperty(raw: HubSpotProperty): PortalProperty {
  return {
    name: raw.name,
    label: raw.label ?? raw.name,
    type: raw.type ?? "string",
    fieldType: raw.fieldType ?? "text",
    groupName: raw.groupName ?? null,
    description: raw.description ? raw.description.slice(0, 300) : null,
    options: (raw.options ?? [])
      .filter((option) => !option.hidden && option.value !== undefined)
      .slice(0, 200)
      .map((option) => ({
        label: option.label ?? String(option.value),
        value: String(option.value),
      })),
    hubspotDefined: Boolean(raw.hubspotDefined),
    calculated: Boolean(raw.calculated),
    readOnlyValue: Boolean(raw.modificationMetadata?.readOnlyValue),
    referencedObjectType: raw.referencedObjectType ?? null,
    hidden: Boolean(raw.hidden),
  };
}

/** Stores one object's property definitions (upsert by object). */
export async function storePortalObject(
  object: CrmObject,
  properties: PortalProperty[],
  fetchedBy: string,
  fetchedAt: string,
) {
  const row = {
    crmObject: object,
    provider: "hubspot",
    properties: JSON.stringify(properties),
    fetchedAt,
    fetchedBy,
  };
  await getDb()
    .insert(schema.paCrmSchema)
    .values(row)
    .onConflictDoUpdate({
      target: schema.paCrmSchema.crmObject,
      set: {
        properties: row.properties,
        fetchedAt,
        fetchedBy,
        provider: "hubspot",
      },
    });
}

/** Reads the three objects' property definitions from HubSpot and stores them. */
export async function refreshHubSpotSchema(
  fetchedBy: string,
  now: Date,
): Promise<PortalSchema> {
  const fetchedAt = now.toISOString();
  const objects: PortalSchema["objects"] = {};
  for (const object of CRM_OBJECTS) {
    const body = (await hubspotFetchWithTimeout(
      `/crm/v3/properties/${object}?archived=false`,
      undefined,
      20_000,
    )) as {
      results?: HubSpotProperty[];
    };
    const properties = (body.results ?? [])
      .filter((item) => !item.archived)
      .map(toPortalProperty);
    objects[object] = properties;
    await storePortalObject(object, properties, fetchedBy, fetchedAt);
  }
  return { fetchedAt, objects };
}

/** The stored snapshot, or null before the first refresh. */
export async function loadPortalSchema(): Promise<PortalSchema | null> {
  const rows = await getDb().select().from(schema.paCrmSchema);
  if (rows.length === 0) return null;
  const objects: PortalSchema["objects"] = {};
  let fetchedAt = rows[0].fetchedAt;
  for (const row of rows) {
    try {
      objects[row.crmObject as CrmObject] = JSON.parse(
        row.properties,
      ) as PortalProperty[];
    } catch {
      throw new Error(`pa_crm_schema.${row.crmObject} holds invalid JSON`);
    }
    if (row.fetchedAt < fetchedAt) fetchedAt = row.fetchedAt;
  }
  return { fetchedAt, objects };
}
