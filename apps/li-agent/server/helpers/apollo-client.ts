import { readAppSecret } from "@agent-native/core/secrets";
import { getRequestOrgId } from "@agent-native/core/server";

const APOLLO_API_BASE = "https://api.apollo.io/api/v1";

// Vault-first, env-fallback — mirrors apps/prospecting-hub/server/helpers/
// apollo-client.ts exactly, including the "workspace" (not "org") secret
// scope. Kept as its own copy per app rather than a shared package, matching
// the precedent set there (this is app-local, on-demand functionality, not
// core to every app in the workspace).
export async function getApolloToken(): Promise<string | null> {
  const orgId = getRequestOrgId();
  if (orgId) {
    const stored = await readAppSecret({ key: "APOLLO_API_KEY", scope: "workspace", scopeId: orgId });
    if (stored?.value) return stored.value;
  }
  return process.env.APOLLO_API_KEY ?? null;
}

const DEFAULT_APOLLO_TIMEOUT_MS = 20_000;

async function apolloFetch(path: string, options?: RequestInit, timeoutMs: number = DEFAULT_APOLLO_TIMEOUT_MS): Promise<unknown> {
  const apiKey = await getApolloToken();
  if (!apiKey) {
    throw new Error("Apollo not connected. Set APOLLO_API_KEY in Settings or your environment.");
  }
  const res = await fetch(`${APOLLO_API_BASE}${path}`, {
    ...options,
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Apollo error (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json();
}

export interface ApolloPersonMatch {
  title?: string;
  seniority?: string;
  email?: string;
  email_status?: string;
  linkedin_url?: string;
  organization?: { primary_domain?: string; name?: string } | null;
  // Only present when Apollo already has this person "revealed" for our
  // team (e.g. previously enriched, or CRM-synced) — live-confirmed this
  // nests real, unmasked phone numbers with no extra reveal step or
  // webhook required. For a person Apollo has never revealed for this
  // team, `contact` is absent and phone_numbers has to go through Apollo's
  // separate paid async reveal_phone_number + webhook flow, which this
  // integration does not implement.
  contact?: { phone_numbers?: Array<{ raw_number?: string; type?: string }> } | null;
}

interface ApolloPersonMatchResponse {
  person?: ApolloPersonMatch | null;
}

// A no-match is a normal, expected outcome (null), never an error.
export async function matchApolloPerson(options: {
  name: string;
  companyName?: string | null;
  email?: string | null;
}): Promise<ApolloPersonMatch | null> {
  const body: Record<string, unknown> = { name: options.name };
  if (options.companyName) body.organization_name = options.companyName;
  if (options.email) body.email = options.email;
  const result = (await apolloFetch("/people/match", {
    method: "POST",
    body: JSON.stringify(body),
  })) as ApolloPersonMatchResponse;
  return result.person ?? null;
}

// Synchronous-only: returns null when Apollo hasn't already revealed this
// person for our team (see ApolloPersonMatch.contact comment). Never
// triggers Apollo's paid async phone reveal.
export function extractApolloPhone(person: ApolloPersonMatch | null): string | null {
  return person?.contact?.phone_numbers?.[0]?.raw_number ?? null;
}

export interface ApolloOrganization {
  industry?: string;
  estimated_num_employees?: number;
  country?: string;
  linkedin_url?: string;
}

interface ApolloOrganizationSearchResponse {
  organizations?: ApolloOrganization[];
}

// Same "prefer exact name match, fall back to top result" cascade as
// prospecting-hub's enrichApolloOrganization.
export async function enrichApolloOrganization(options: {
  companyName?: string | null;
  domain?: string | null;
}): Promise<ApolloOrganization | null> {
  if (!options.domain && !options.companyName) return null;
  const body: Record<string, unknown> = options.domain
    ? { q_organization_domains: [options.domain], page: 1, per_page: 1 }
    : { q_organization_name: options.companyName, page: 1, per_page: 5 };
  const result = (await apolloFetch("/organizations/search", {
    method: "POST",
    body: JSON.stringify(body),
  })) as ApolloOrganizationSearchResponse;
  const organizations = result.organizations ?? [];
  if (organizations.length === 0) return null;
  const companyLower = options.companyName?.trim().toLowerCase();
  const exactMatch = companyLower
    ? organizations.find((o) => (o as { name?: string }).name?.trim().toLowerCase() === companyLower)
    : undefined;
  return exactMatch ?? organizations[0];
}
