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

// Apollo's Organization Enrichment response (GET /organizations/enrich) —
// fields confirmed against the live API reference. Live-confirmed there is
// NO intent/score field anywhere in this response — see
// extractApolloIntentScore below.
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

interface ApolloOrganizationEnrichResponse {
  organization?: ApolloOrganization | null;
}

export async function enrichApolloOrganization(options: {
  companyName?: string | null;
  domain?: string | null;
}): Promise<ApolloOrganization | null> {
  const params = new URLSearchParams();
  if (options.domain) params.set("domain", options.domain);
  if (options.companyName) params.set("name", options.companyName);
  if ([...params.keys()].length === 0) return null;
  const result = (await apolloFetch(`/organizations/enrich?${params.toString()}`)) as ApolloOrganizationEnrichResponse;
  return result.organization ?? null;
}

// Apollo's real intent data (Bombora-powered topic-surge signals) is NOT
// present in either /people/match's or /organizations/enrich's documented
// response schema — confirmed via a live fetch of Apollo's own API
// reference during this feature's design. It appears to live behind a
// separate, higher-tier feature this environment has no way to verify
// against a real Apollo connection. Rather than fabricate an undocumented
// endpoint, this looks for a couple of plausible field names defensively and
// returns null otherwise — most Apollo plans will show no Intent Score
// rather than a guessed/invented one. If your Apollo plan does expose intent
// data and this stays null, the actual field name will need to be confirmed
// live and added here.
export function extractApolloIntentScore(organization: ApolloOrganization | null): number | null {
  const raw =
    (organization as unknown as { intent_strength?: unknown } | null)?.intent_strength ??
    (organization as unknown as { intent_score?: unknown } | null)?.intent_score;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return Math.max(0, Math.min(100, Math.round(raw)));
}
