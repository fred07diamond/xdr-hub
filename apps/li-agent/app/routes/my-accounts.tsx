import { useActionQuery } from "@agent-native/core/client";
import { IconBriefcase, IconExternalLink, IconLoader2, IconSearch } from "@tabler/icons-react";
import { Link } from "react-router";

import { CompanyLogo } from "@/components/company-logo";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `${APP_TITLE} — My Accounts` }];
}

interface OwnedCompany {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employeeCount: string | null;
}

interface MyOwnedAccountsData {
  connected: boolean;
  matched: boolean;
  noOwnerRecord?: boolean;
  error?: string;
  companies: OwnedCompany[];
  total: number;
  truncated?: boolean;
}

// Same "just open a URL, no scraping or auto-navigation" pattern as the
// existing LinkedIn fallback links in _index.tsx/lead-lists.tsx --
// /sales/search/people is Sales Navigator's own search view (see
// extension/content.js's comment on why the Lead tab specifically), pre-
// filled with the company name as a keyword so the xDR lands on a results
// page instead of a blank search.
function salesNavSearchHref(companyName: string): string {
  return `https://www.linkedin.com/sales/search/people?keywords=${encodeURIComponent(companyName)}`;
}

export default function MyAccounts() {
  const { data, isLoading } = useActionQuery<MyOwnedAccountsData>("get-my-owned-accounts", {});

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-1 flex items-center gap-2">
        <IconBriefcase className="size-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">My Accounts</h1>
        {!!data?.companies.length && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{data.companies.length}</span>
        )}
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        Companies where you're the xDR Owner in HubSpot -- jump straight into a Sales Navigator search for people at each one.
      </p>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <IconLoader2 className="size-4 animate-spin" />
          Loading…
        </div>
      )}

      {!isLoading && data && !data.connected && (
        <p className="text-sm text-muted-foreground">
          HubSpot isn't connected.{" "}
          <Link to="/settings#hubspot" className="text-primary hover:underline">
            Connect it in Settings
          </Link>{" "}
          to see your owned accounts.
        </p>
      )}

      {!isLoading && data?.connected && data.noOwnerRecord && (
        <p className="text-sm text-muted-foreground">
          We couldn't find a HubSpot owner record matching your email. Ask an admin to confirm your HubSpot seat uses the
          same email you sign in here with.
        </p>
      )}

      {!isLoading && data?.connected && data.matched && data.companies.length === 0 && (
        <p className="text-sm text-muted-foreground">No companies are currently assigned to you as xDR Owner in HubSpot.</p>
      )}

      {!isLoading && data?.error && <p className="text-sm text-destructive">{data.error}</p>}

      {!isLoading && data?.matched && data.companies.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Company</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Industry</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Employees</th>
                <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Search</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.companies.map((c) => (
                <tr key={c.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <CompanyLogo name={c.name} domain={c.domain} />
                      <span className="truncate font-medium text-foreground">{c.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{c.industry ?? "—"}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{c.employeeCount ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right">
                    <a
                      href={salesNavSearchHref(c.name)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                    >
                      <IconSearch size={11} /> Search on LinkedIn
                      <IconExternalLink size={10} />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.truncated && (
            <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
              Showing {data.companies.length} of {data.total} owned accounts.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
