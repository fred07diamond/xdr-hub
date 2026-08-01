// Deterministic company-fit scoring from firmographic signals (country,
// employee count) — adapted from the real QL Scoring Model found in the
// sales docs, restricted to only the two firmographic fields this app can
// currently obtain. This is a SEPARATE, better-precision company-fit signal
// from the existing AI-judged `companyFitScore` computed in
// score-contact.ts. Callers MUST treat a `null` return (both inputs absent)
// as "fall back to the AI-judged score" — never as a score of zero.

const TIER_1_COUNTRIES = ["united states", "canada"];

const TIER_2_COUNTRIES = [
  "france",
  "germany",
  "switzerland",
  "netherlands",
  "united kingdom",
  "ireland",
  "spain",
  "italy",
  "norway",
  "sweden",
  "denmark",
  "finland",
  "belgium",
  "israel",
  "australia",
  "japan",
];

function countryPoints(country: string | null | undefined): number {
  if (!country) return 0;
  const lower = country.toLowerCase();
  if (TIER_1_COUNTRIES.some((c) => lower.includes(c))) return 2;
  if (TIER_2_COUNTRIES.some((c) => lower.includes(c))) return 1;
  return 0;
}

function employeePoints(employees: number | null | undefined): number {
  if (employees == null) return 0;
  if (employees >= 500) return 5;
  if (employees >= 250) return 3;
  if (employees >= 100) return 1;
  return 0;
}

export function computeDeterministicCompanyFit(input: {
  country?: string | null;
  employees?: number | null;
}): number | null {
  // Nothing to compute from — the caller should fall back to the AI-judged
  // company fit score in this case, not treat this as a zero.
  if (input.country == null && input.employees == null) return null;

  const points = countryPoints(input.country) + employeePoints(input.employees);
  const normalized = Math.round((points / 7) * 100);
  return Math.max(0, Math.min(100, normalized));
}
