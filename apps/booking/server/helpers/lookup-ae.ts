import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { userRoles } from "../db/schema.js";
import { hubspotFetch } from "./hubspot-client.js";

// Returns the email of the AE who owns the account for the given company name.
// Returns null if HubSpot lookup fails or the owner email is not in our users table.
export async function lookupAeByCompany(company: string): Promise<string | null> {
  try {
    const result = (await hubspotFetch("/crm/v3/objects/companies/search", {
      method: "POST",
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [
              { propertyName: "name", operator: "EQ", value: company },
            ],
          },
        ],
        properties: ["name", "hubspot_owner_id"],
        limit: 1,
      }),
    })) as { results?: Array<{ properties: Record<string, string> }> };

    const ownerId = result.results?.[0]?.properties?.hubspot_owner_id;
    if (!ownerId) return null;

    const owner = (await hubspotFetch(`/crm/v3/owners/${ownerId}`)) as {
      email?: string;
    };
    const aeEmail = owner.email ?? null;
    if (!aeEmail) return null;

    // Verify the AE has a record in our user_roles table
    const db = getDb();
    const row = await db
      .select({ email: userRoles.email })
      .from(userRoles)
      .where(eq(userRoles.email, aeEmail))
      .limit(1);

    return row[0]?.email ?? null;
  } catch {
    return null;
  }
}
