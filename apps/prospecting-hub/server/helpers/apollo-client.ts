import { readAppSecret } from "@agent-native/core/secrets";
import { getRequestOrgId } from "@agent-native/core/server";

const APOLLO_API_BASE = "https://api.apollo.io/api/v1";

// Vault-first, env-fallback — mirrors packages/shared/src/server/hubspot-client.ts's
// getHubSpotToken() exactly. scope: "workspace" (not "org") follows the
// secrets skill's own documented registerRequiredSecret/readAppSecret
// contract, since register-secrets.ts registers this key with
// registerRequiredSecret for the first time in this repo — see that file's
// own comment on why this diverges from hubspot-client.ts's "org" scope.
export async function getApolloToken(): Promise<string | null> {
  const orgId = getRequestOrgId();
  if (orgId) {
    const stored = await readAppSecret({ key: "APOLLO_API_KEY", scope: "workspace", scopeId: orgId });
    if (stored?.value) return stored.value;
  }
  // guard:allow-env-credential — env fallback only when no vault-stored secret exists for this org (single-workspace bootstrap/local-dev path, not a per-user credential)
  return process.env.APOLLO_API_KEY ?? null;
}

const DEFAULT_APOLLO_TIMEOUT_MS = 20_000;

// Same "bare fetch() with no timeout leaves the caller hanging forever"
// class of bug already fixed for commonroom-client.ts's callMcpToolWithTimeout
// and hubspot-client.ts's hubspotFetchWithTimeout, both added only after a
// live-confirmed hang — this ships with the timeout built in from the start.
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

export interface ApolloEmploymentHistoryEntry {
  organization_name?: string;
  title?: string;
  start_date?: string;
  end_date?: string;
  current?: boolean;
}

// Apollo's People Match response — fields confirmed against the live API
// reference (POST /people/match). `organization` is the nested org object
// the same match returns, used as a higher-confidence domain hint for
// enrichApolloOrganization below instead of falling back to company-name-only
// matching.
export interface ApolloPersonMatch {
  title?: string;
  seniority?: string;
  email_status?: string;
  linkedin_url?: string;
  employment_history?: ApolloEmploymentHistoryEntry[];
  organization?: { primary_domain?: string; name?: string } | null;
}

interface ApolloPersonMatchResponse {
  person?: ApolloPersonMatch | null;
}

// Defensively parsed: a no-match is a normal, expected outcome (null), never
// an error — same discipline as this app's CommonRoom/HubSpot lookups.
//
// Live-confirmed this workspace's currently-connected API key returns 403
// API_INACCESSIBLE on this endpoint (scoped for organization search only,
// not person-level lookups) — enrich-contact-with-apollo.ts's per-endpoint
// warning handling surfaces that clearly rather than failing the whole
// enrichment. Broadening the key's scope in Apollo's dashboard to include
// People Match is the only way to make this endpoint work; no code change
// here would fix a scope-denied key.
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

export interface ApolloFundingEvent {
  date?: string;
  type?: string;
  amount?: number;
  investors?: string[];
}

// Sourced from POST /organizations/search, not GET /organizations/enrich —
// live-confirmed against this workspace's actual connected API key that
// /organizations/enrich (and /people/match, /people/search,
// /mixed_people/search) return 403 API_INACCESSIBLE ("not authorized...
// configured scope"), while /organizations/search is accessible. /search
// returns the same core firmographic fields /enrich would (industry,
// estimated_num_employees, country) plus real intent fields this session
// didn't expect to find (see extractApolloIntentScore) — but live-confirmed
// it does NOT return total_funding/latest_funding_stage/funding_events/
// technology_names at all (present in /enrich's documented schema, absent
// from every /search response observed). Those four fields stay optional
// here and will simply read as null/undefined via this code path — only a
// key with /organizations/enrich access would ever populate them.
export interface ApolloOrganization {
  industry?: string;
  estimated_num_employees?: number;
  country?: string;
  total_funding?: number;
  latest_funding_stage?: string;
  technology_names?: string[];
  funding_events?: ApolloFundingEvent[];
  linkedin_url?: string;
}

interface ApolloOrganizationSearchResponse {
  organizations?: ApolloOrganization[];
}

// Domain search (q_organization_domains) is a tight, effectively-exact match
// — live-confirmed a single domain returns exactly that company. Name search
// (q_organization_name) is a much looser substring/relevance match — live-
// confirmed "Nike" returned 354 total results including unrelated companies
// with "Nike" in their name, Apollo's own top-ranked result being the real
// Nike. Preferring an exact case-insensitive name match over the raw
// top-ranked result when one exists, falling back to the top result
// otherwise — same "prefer exact match, fall back to the best available
// single result" discipline as commonroom-engagement.ts's own contact/org
// matching cascade.
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

// Apollo's Bombora-powered intent data DOES exist and IS reachable — live-
// confirmed `intent_strength`/`show_intent`/`has_intent_signal_account` come
// back on /organizations/search results (this session's org didn't have an
// active intent signal, so the live example observed was null/false — the
// field's actual populated shape/range when a real signal exists is still
// unconfirmed). Defensively parsed regardless: a non-numeric or absent value
// resolves to null, never a guessed/invented score.
export function extractApolloIntentScore(organization: ApolloOrganization | null): number | null {
  const raw = (organization as unknown as { intent_strength?: unknown } | null)?.intent_strength;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return Math.max(0, Math.min(100, Math.round(raw)));
}
