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

// Clearbit's free public logo API keyed by domain -- HubSpot has no logo
// field at all, this is the standard non-HubSpot trick for "give me a logo
// for this domain." Falls back to a lettered avatar when there's no domain
// or the image 404s. Shared by the Prospects table's Company column and
// the My Accounts page.
export function CompanyLogo({ name, domain }: { name: string | null; domain: string | null }) {
  const [imgFailed, setImgFailed] = useState(false);
  const effectiveDomain = domain ?? (name ? guessCompanyDomain(name) : null);
  if (effectiveDomain && !imgFailed) {
    return (
      <img
        src={`https://logo.clearbit.com/${effectiveDomain}`}
        onError={() => setImgFailed(true)}
        alt=""
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
