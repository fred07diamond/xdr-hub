import { useState } from "react";
import { cn } from "@/lib/utils";

// Same lettered-avatar hash used in booking/meetings.tsx and settings.tsx,
// keyed by company name instead of a person's email.
const COMPANY_AVATAR_COLORS = ["bg-indigo-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-sky-500", "bg-violet-500"];
function companyAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return COMPANY_AVATAR_COLORS[Math.abs(hash) % COMPANY_AVATAR_COLORS.length];
}

const COMPANY_SUFFIX_RE = /\s*[,]?\s*\b(inc\.?|llc\.?|ltd\.?|corp\.?|corporation|company|co\.?|gmbh|plc)\b\.?\s*$/i;

// companyDomain only backfills once a prospect is re-enriched (see
// CLAUDE.md), so most existing rows have none yet. Guessing a plausible
// domain from the company name lets the logo work today for common
// companies instead of every pre-existing row showing only the letter
// fallback -- worst case a wrong guess just 404s and CompanyLogo falls
// back to the same lettered avatar it would have shown anyway.
function guessCompanyDomain(name: string): string | null {
  const cleaned = name
    .replace(/\([^)]*\)/g, "")
    .replace(COMPANY_SUFFIX_RE, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return cleaned ? `${cleaned}.com` : null;
}

// HubSpot has no company-logo field at all, so the logo has to come from a
// domain-keyed third-party service.
//
// This used to use logo.clearbit.com, which is DEAD -- Clearbit was
// acquired by HubSpot and the free public logo endpoint was retired; it now
// has no DNS record at all, so every request failed and every company
// silently fell back to the lettered avatar. Verified with dig/curl, which
// is why this is a source CHAIN rather than a single provider: if one goes
// away the same way, the next still resolves instead of the whole feature
// quietly degrading again.
//
// Both providers below return a real 404 for a domain they don't know
// (verified), rather than a generic globe placeholder -- that matters,
// because a placeholder would render as though it were the company's real
// logo. A 404 triggers onError, so we advance to the next source and
// ultimately to the lettered avatar, which is honest about not knowing.
function logoSources(domain: string): string[] {
  return [
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
  ];
}

// Shared by the Prospects table's Company column, its hover card, and the
// My Accounts page/detail panel.
export function CompanyLogo({ name, domain }: { name: string | null; domain: string | null }) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const effectiveDomain = domain ?? (name ? guessCompanyDomain(name) : null);
  const sources = effectiveDomain ? logoSources(effectiveDomain) : [];
  const src = sources[sourceIndex];

  if (src) {
    return (
      <img
        // Keyed by src so swapping sources remounts the <img>: without this,
        // React reuses the element and some browsers won't re-fire load/error
        // for the new URL, stranding it on the failed source.
        key={src}
        src={src}
        onError={() => setSourceIndex((i) => i + 1)}
        alt=""
        loading="lazy"
        className="h-5 w-5 shrink-0 rounded-sm bg-white object-contain ring-1 ring-black/5"
      />
    );
  }

  const label = (name ?? "?").trim();
  return (
    <div className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-[10px] font-semibold text-white", companyAvatarColor(label))}>
      {(label[0] ?? "?").toUpperCase()}
    </div>
  );
}
