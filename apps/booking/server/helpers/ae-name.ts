import { hubspotFetch } from "./hubspot-client.js";

export interface AeName {
  fullName: string;
  firstName: string;
}

// Resolve an internal email to a human name via HubSpot owner records —
// the same source the meetings UI uses for display names.
export async function getOwnerName(email: string): Promise<AeName | null> {
  try {
    const result = (await hubspotFetch(
      `/crm/v3/owners?email=${encodeURIComponent(email)}`,
    )) as { results?: Array<{ firstName?: string; lastName?: string }> };
    const owner = result.results?.[0];
    const firstName = owner?.firstName?.trim() ?? "";
    const fullName = [owner?.firstName, owner?.lastName]
      .map((p) => p?.trim())
      .filter(Boolean)
      .join(" ");
    if (!firstName && !fullName) return null;
    return {
      fullName: fullName || firstName,
      firstName: firstName || fullName.split(" ")[0],
    };
  } catch {
    return null;
  }
}

// The generation prompt intentionally emits [AE First Name] / [AE Full Name]
// when the transcript doesn't name the AE (cold calls never do) — the AE is
// resolved from HubSpot after generation, so fill the placeholders then.
export function fillAePlaceholders(text: string, name: AeName): string {
  return text
    .replace(/\[AE Full Name\]/gi, name.fullName)
    .replace(/\[AE First Name\]/gi, name.firstName);
}
