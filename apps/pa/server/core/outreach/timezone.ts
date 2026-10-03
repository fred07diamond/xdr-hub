// The lead's time zone (D103), so follow-ups come due in their business
// hours: HubSpot's own time zone property first, then the form's country.

/** HubSpot stores "america_slash_new_york"; Intl wants "America/New_York". */
export function fromHubSpotTimezone(value: string | null | undefined) {
  if (!value) return null;
  const zone = value
    .split("_slash_")
    .map((part) =>
      part
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join("_"),
    )
    .join("/");
  return validZone(zone) ? zone : null;
}

function validZone(zone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** One representative zone per country (the most populous for wide ones). */
const COUNTRY_ZONES: Record<string, string> = {
  "united states": "America/Chicago",
  usa: "America/Chicago",
  us: "America/Chicago",
  canada: "America/Toronto",
  mexico: "America/Mexico_City",
  brazil: "America/Sao_Paulo",
  argentina: "America/Argentina/Buenos_Aires",
  chile: "America/Santiago",
  colombia: "America/Bogota",
  peru: "America/Lima",
  "united kingdom": "Europe/London",
  uk: "Europe/London",
  ireland: "Europe/Dublin",
  portugal: "Europe/Lisbon",
  spain: "Europe/Madrid",
  france: "Europe/Paris",
  belgium: "Europe/Brussels",
  netherlands: "Europe/Amsterdam",
  germany: "Europe/Berlin",
  switzerland: "Europe/Zurich",
  austria: "Europe/Vienna",
  italy: "Europe/Rome",
  denmark: "Europe/Copenhagen",
  sweden: "Europe/Stockholm",
  norway: "Europe/Oslo",
  finland: "Europe/Helsinki",
  poland: "Europe/Warsaw",
  "czech republic": "Europe/Prague",
  czechia: "Europe/Prague",
  greece: "Europe/Athens",
  romania: "Europe/Bucharest",
  ukraine: "Europe/Kyiv",
  turkey: "Europe/Istanbul",
  israel: "Asia/Jerusalem",
  "united arab emirates": "Asia/Dubai",
  "saudi arabia": "Asia/Riyadh",
  egypt: "Africa/Cairo",
  "south africa": "Africa/Johannesburg",
  nigeria: "Africa/Lagos",
  kenya: "Africa/Nairobi",
  india: "Asia/Kolkata",
  pakistan: "Asia/Karachi",
  bangladesh: "Asia/Dhaka",
  singapore: "Asia/Singapore",
  malaysia: "Asia/Kuala_Lumpur",
  indonesia: "Asia/Jakarta",
  philippines: "Asia/Manila",
  vietnam: "Asia/Ho_Chi_Minh",
  thailand: "Asia/Bangkok",
  china: "Asia/Shanghai",
  "hong kong": "Asia/Hong_Kong",
  taiwan: "Asia/Taipei",
  japan: "Asia/Tokyo",
  "south korea": "Asia/Seoul",
  australia: "Australia/Sydney",
  "new zealand": "Pacific/Auckland",
};

export function zoneForCountry(country: string | null | undefined) {
  if (!country) return null;
  return COUNTRY_ZONES[country.trim().toLowerCase()] ?? null;
}

export function leadTimezone(input: {
  hubspotTimezone?: string | null;
  country?: string | null;
}): string | null {
  return (
    fromHubSpotTimezone(input.hubspotTimezone) ?? zoneForCountry(input.country)
  );
}
