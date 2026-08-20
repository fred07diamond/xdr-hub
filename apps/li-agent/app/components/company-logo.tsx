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
// Google's favicon service goes FIRST: verified better coverage than
// DuckDuckGo (e.g. agilisium.com 404s on DDG but resolves on Google), and
// sz=64 returns a consistent 64px source, so downscaling to a small box
// stays crisp instead of upscaling a blurry 16px .ico.
//
// Both 404 for a domain they don't know, which triggers onError so we
// advance to the next source and ultimately to the lettered avatar. Note
// DDG's 404 still carries a generic placeholder image as its body -- a
// browser that renders 404 bodies would show that grey globe as though it
// were the company's logo, which is another reason DDG is second, not
// first.
function logoSources(domain: string): string[] {
  return [
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
  ];
}

// One fixed box for both the image and the lettered fallback, so every row
// in a table aligns on the same width regardless of which one renders or
// what aspect ratio the fetched icon happens to have.
const BOX = "size-6 shrink-0 rounded-md";

// Shared by the Prospects table's Company column, its hover card, and the
// My Accounts page/detail panel.
export function CompanyLogo({ name, domain }: { name: string | null; domain: string | null }) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const effectiveDomain = domain ?? (name ? guessCompanyDomain(name) : null);
  const sources = effectiveDomain ? logoSources(effectiveDomain) : [];
  const src = sources[sourceIndex];

  if (src) {
    return (
      // Centering the image inside a padded box (rather than sizing the
      // <img> itself) keeps a wide wordmark and a square glyph optically
      // consistent, and stops either from touching the border.
      <span className={cn(BOX, "flex items-center justify-center overflow-hidden border border-border/60 bg-white p-0.5")}>
        <img
          // Keyed by src so swapping sources remounts the <img>: without
          // this, React reuses the element and some browsers won't re-fire
          // load/error for the new URL, stranding it on the failed source.
          key={src}
          src={src}
          onError={() => setSourceIndex((i) => i + 1)}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="max-h-full max-w-full object-contain"
        />
      </span>
    );
  }

  const label = (name ?? "?").trim();
  return (
    <span
      className={cn(
        BOX,
        "flex items-center justify-center text-[11px] font-semibold leading-none text-white",
        companyAvatarColor(label),
      )}
    >
      {(label[0] ?? "?").toUpperCase()}
    </span>
  );
}
