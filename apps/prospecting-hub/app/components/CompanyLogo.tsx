import { useState } from "react";
import { cn } from "@/lib/utils";

// Ported from apps/li-agent/app/components/company-logo.tsx to keep company
// branding visually identical across both apps' contact/prospect tables.

const COMPANY_AVATAR_COLORS = ["bg-indigo-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-sky-500", "bg-violet-500"];
function companyAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return COMPANY_AVATAR_COLORS[Math.abs(hash) % COMPANY_AVATAR_COLORS.length];
}

const COMPANY_SUFFIX_RE = /\s*[,]?\s*\b(inc\.?|llc\.?|ltd\.?|corp\.?|corporation|company|co\.?|gmbh|plc)\b\.?\s*$/i;

// No enriched domain field exists on prospecting-hub's contacts yet, so
// every row relies on this guess -- worst case a wrong guess just 404s and
// CompanyLogo falls back to the same lettered avatar it would show anyway.
function guessCompanyDomain(name: string): string | null {
  const cleaned = name
    .replace(/\([^)]*\)/g, "")
    .replace(COMPANY_SUFFIX_RE, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return cleaned ? `${cleaned}.com` : null;
}

// Google favicons first (better domain coverage, consistent 64px source),
// DuckDuckGo second as a redundant fallback -- see company-logo.tsx in
// li-agent for the full source-chain rationale (logo.clearbit.com is dead).
function logoSources(domain: string): string[] {
  return [
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
  ];
}

// One fixed box for both the image and the lettered fallback, so every row
// in a table aligns on the same width regardless of which one renders.
const BOX = "size-6 shrink-0 rounded-md";

export function CompanyLogo({ name, domain }: { name: string | null; domain: string | null }) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const effectiveDomain = domain ?? (name ? guessCompanyDomain(name) : null);
  const sources = effectiveDomain ? logoSources(effectiveDomain) : [];
  const src = sources[sourceIndex];

  if (src) {
    return (
      <span className={cn(BOX, "flex items-center justify-center overflow-hidden border border-border/60 bg-white p-0.5")}>
        <img
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
