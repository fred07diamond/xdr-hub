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

// Names/titles/companies captured from LinkedIn sometimes carry emoji
// (e.g. a paintbrush glyph after a name) that people add to their profile
// -- live-confirmed these measurably hurt Apollo's fuzzy name/company
// matching, so every value sent to Apollo goes through this first.
// Extended_Pictographic covers the actual emoji glyphs; U+FE0F (variation
// selector) and U+200D (zero-width joiner) strip the invisible characters
// that stitch compound emoji together; the regional-indicator range
// strips flag emoji specifically since those aren't Extended_Pictographic.
// Deliberately narrow -- does not touch accents, non-Latin scripts, or
// ordinary punctuation like apostrophes.
const EMOJI_PATTERN = new RegExp(
  "\\p{Extended_Pictographic}|\\u{FE0F}|\\u{200D}|[\\u{1F1E6}-\\u{1F1FF}]",
  "gu",
);

function cleanForApolloMatch(text: string | null | undefined): string | null {
  if (!text) return null;
  const cleaned = text
    .replace(EMOJI_PATTERN, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || null;
}

export interface ApolloPersonMatch {
  // Apollo's own person id -- live-confirmed this is how the async phone-
  // reveal webhook payload identifies which person its result is for
  // (nested in a `people[]` array with a `type_cd`-labeled phone_numbers
  // array, NOT the same shape as this synchronous response's `contact`
  // field). There is no request_id round-trip despite Apollo's docs
  // suggesting one -- matching must happen via this id.
  id?: string;
  name?: string;
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
  // separate paid async reveal_phone_number + webhook flow (see
  // matchApolloPerson's revealPhone option and
  // actions/apollo-phone-reveal-webhook.ts).
  contact?: { phone_numbers?: Array<{ raw_number?: string; type?: string }> } | null;
}

interface ApolloPersonMatchResponse {
  person?: ApolloPersonMatch | null;
}

// Live-confirmed via a direct 400 test: reveal_phone_number requires a
// valid webhook_url, full stop -- there is no polling-without-webhook
// shortcut despite Apollo's docs suggesting /webhook_result/{request_id}
// polling as a standalone alternative (that polling id never actually
// appears anywhere in this flow -- see ApolloPersonMatch.id).
export const APOLLO_PHONE_REVEAL_WEBHOOK_URL = "https://xdr-hub.netlify.app/li-agent/_agent-native/actions/apollo-phone-reveal-webhook";

// A no-match is a normal, expected outcome (null person), never an error.
// When revealPhone is set, the caller must remember person.id themselves
// (not returned separately here) to match the later webhook callback.
export async function matchApolloPerson(options: {
  name: string;
  companyName?: string | null;
  email?: string | null;
  revealPhone?: boolean;
}): Promise<ApolloPersonMatch | null> {
  const cleanedName = cleanForApolloMatch(options.name);
  if (!cleanedName) return null;
  const body: Record<string, unknown> = { name: cleanedName };
  const cleanedCompany = cleanForApolloMatch(options.companyName);
  if (cleanedCompany) body.organization_name = cleanedCompany;
  if (options.email) body.email = options.email;
  if (options.revealPhone) {
    body.reveal_phone_number = true;
    body.webhook_url = APOLLO_PHONE_REVEAL_WEBHOOK_URL;
  }
  const result = (await apolloFetch("/people/match", {
    method: "POST",
    body: JSON.stringify(body),
  })) as ApolloPersonMatchResponse;
  return result.person ?? null;
}

// Live-confirmed Apollo's contact.phone_numbers frequently puts a
// company-level number (type "work_hq") at position 0 and the person's own
// number (type "mobile") later in the array -- position/order is NOT
// reliable, so this must select by type rather than take index [0]. Only
// returns a number tagged as one of the person's own phone types; if Apollo
// only has a company-level number for this person, returns null (same "we
// have nothing" convention as a blank email) rather than showing a number
// that isn't actually theirs.
const PERSONAL_PHONE_TYPES = new Set(["mobile", "direct", "personal", "home"]);

// Shared by extractApolloPhone (synchronous match response) and the
// reveal-phone webhook receiver (async callback payload) -- same type-based
// selection logic, applied to whatever phone_numbers array either shape
// hands it.
export function pickPersonalPhoneNumber(numbers: Array<{ raw_number?: string; type?: string }> | null | undefined): string | null {
  if (!numbers?.length) return null;
  const personal = numbers.find((n) => n.raw_number && PERSONAL_PHONE_TYPES.has((n.type ?? "").toLowerCase()));
  return personal?.raw_number ?? null;
}

// Synchronous-only: returns null when Apollo hasn't already revealed this
// person for our team (see ApolloPersonMatch.contact comment).
export function extractApolloPhone(person: ApolloPersonMatch | null): string | null {
  return pickPersonalPhoneNumber(person?.contact?.phone_numbers);
}

export interface ApolloOrganization {
  industry?: string;
  estimated_num_employees?: number;
  country?: string;
  linkedin_url?: string;
}

interface ApolloOrganizationEnrichResponse {
  organization?: ApolloOrganization | null;
}

function domainFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at === -1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain || null;
}

// Live-confirmed this workspace's current Apollo key is scoped for
// /organizations/enrich (exact domain lookup) but returns 403
// API_INACCESSIBLE on /organizations/search (name search) -- the mirror
// image of the PREVIOUS key's scope gap, which had search but not enrich
// (see git history: "fix: use organizations/search instead of
// organizations/enrich"). Only ever calls /organizations/enrich now.
// Domain comes from Apollo's own person-match response when available,
// falling back to the domain portion of the person's email address --
// without either, there's no way to look up the company under this key's
// current scope, and this returns null rather than guessing by name.
export async function enrichApolloOrganization(options: {
  domain?: string | null;
  email?: string | null;
}): Promise<ApolloOrganization | null> {
  const domain = options.domain ?? domainFromEmail(options.email);
  if (!domain) return null;
  const result = (await apolloFetch(`/organizations/enrich?domain=${encodeURIComponent(domain)}`, {
    method: "GET",
  })) as ApolloOrganizationEnrichResponse;
  return result.organization ?? null;
}
