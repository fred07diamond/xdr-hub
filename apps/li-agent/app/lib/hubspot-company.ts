import { useActionQuery } from "@agent-native/core/client";

// Shape returned by actions/get-hubspot-company.ts. Shared by the
// Prospects table's Company hover card, ProspectSheet's Company section,
// and My Accounts' CompanySheet -- all three read the same action, so the
// type and its formatters live here rather than being re-declared per
// route.
export interface HubSpotCompanyData {
  connected: boolean;
  matched: boolean;
  recordUrl?: string | null;
  company?: {
    name: string | null;
    domain: string | null;
    industry: string | null;
    employeeCount: string | null;
    country: string | null;
    companyOwnerName: string | null;
    xdrOwnerName: string | null;
  } | null;
  openDeals?: Array<{ name: string; amount: string | null; closeDate: string | null }>;
  closedLostDeals?: Array<{ name: string; amount: string | null; closeDate: string | null }>;
  topProspects?: Array<{ name: string; title: string | null; email: string | null; lastActivityAt: string | null }>;
}

export function formatDealAmount(amount: string | null): string | null {
  if (!amount) return null;
  const n = Number(amount);
  if (Number.isNaN(n)) return null;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function formatRelativeActivity(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (Number.isNaN(days) || days < 0) return null;
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

// Same action + params across every caller, so react-query dedupes: a row
// already hovered on the Prospects table is already cached by the time its
// detail panel opens.
export function useHubSpotCompany(companyDomain: string | null, companyName: string | null, enabled: boolean) {
  return useActionQuery<HubSpotCompanyData>(
    "get-hubspot-company",
    { companyDomain, companyName },
    { enabled: enabled && !!(companyDomain || companyName) },
  );
}
