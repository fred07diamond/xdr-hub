// Shared by import-prospects-to-segment.ts and run-sourcing-rule-pipeline.ts
// for cross-source contact dedup: a Prospector match's constructed
// `linkedinUrl` (built from CommonRoom's `linkedInHandle`) and a HubSpot
// contact's `hs_linkedin_url`-derived `linkedinUrl` can differ in scheme,
// host, "www.", an "in/" path prefix, trailing slash, casing, and query
// string while still pointing at the exact same LinkedIn profile. Comparing
// the raw strings would miss those duplicates almost every time.
//
// Instead, extract just the vanity-slug — the final non-empty path
// segment — and lowercase it. That slug is what both sources ultimately
// derive from, so it's the one representation stable enough to compare.

/**
 * Normalizes a LinkedIn profile URL (or bare handle/slug) down to its
 * lowercased vanity-slug, ignoring scheme, host, "www.", any leading path
 * segments (e.g. "in/"), trailing slash, and query string/fragment.
 *
 * Returns `null` for a null/empty/whitespace-only input.
 *
 * Examples that all normalize to "jane-doe":
 *   "https://www.linkedin.com/in/jane-doe"
 *   "http://linkedin.com/in/jane-doe/"
 *   "linkedin.com/in/Jane-Doe?trk=abc"
 *   "in/jane-doe"
 *   "jane-doe"
 */
export function normalizeLinkedinUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // Drop query string and/or fragment before splitting into path segments.
  const withoutQueryOrFragment = trimmed.split(/[?#]/)[0] ?? "";

  const segments = withoutQueryOrFragment.split("/").filter((segment) => segment.length > 0);
  const slug = segments[segments.length - 1];
  if (!slug) return null;

  return slug.toLowerCase();
}
