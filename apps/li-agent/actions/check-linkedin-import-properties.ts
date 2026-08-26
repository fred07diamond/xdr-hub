import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getHubSpotToken, hubspotFetch } from "@xdr-hub/shared/server";

// TEMPORARY diagnostic for a new integration being built: confirms whether
// the two contact properties it will write to (linkedin_app_last_imported_by
// / linkedin_app_last_imported) already exist in HubSpot before any mapping
// code is written against them. Safe to delete once that integration ships.
const PROPERTY_NAMES = ["linkedin_app_last_imported_by", "linkedin_app_last_imported"] as const;

interface PropertyOption {
  label: string;
  value: string;
  hidden?: boolean;
}

interface PropertyCheck {
  exists: boolean;
  type?: string;
  fieldType?: string;
  label?: string;
  /** Valid values for an enumeration/select property -- omitted for other types. */
  options?: PropertyOption[];
}

async function checkContactProperty(name: string): Promise<PropertyCheck> {
  try {
    const prop = (await hubspotFetch(`/crm/v3/properties/contacts/${name}`)) as {
      type?: string;
      fieldType?: string;
      label?: string;
      options?: PropertyOption[];
    };
    return {
      exists: true,
      type: prop.type,
      fieldType: prop.fieldType,
      label: prop.label,
      options: prop.type === "enumeration" ? prop.options : undefined,
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes("(404)")) return { exists: false };
    throw err;
  }
}

export default defineAction({
  description:
    "Check whether the linkedin_app_last_imported_by / linkedin_app_last_imported contact properties already exist in HubSpot.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async () => {
    const token = await getHubSpotToken();
    if (!token) return { connected: false as const };

    const results: Record<string, PropertyCheck> = {};
    for (const name of PROPERTY_NAMES) {
      results[name] = await checkContactProperty(name);
    }
    return { connected: true as const, properties: results };
  },
});
