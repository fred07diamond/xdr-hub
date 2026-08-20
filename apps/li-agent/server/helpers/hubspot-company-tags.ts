import { hubspotFetch } from "@xdr-hub/shared/server";

// Which HubSpot company properties become tags on My Accounts, and how
// they're rendered. Chosen for differentiation -- the things that actually
// change how an xDR/AE prioritizes an account -- from the real property set
// observed on this portal's company records.
//
// Properties are resolved by LABEL at runtime, not by hardcoded internal
// name: these are custom properties whose API names are portal-specific
// (a label like "Ideal Customer Profile Tier" could be icp_tier,
// ideal_customer_profile_tier, tier__c, ...). Guessing wrong fails
// silently -- HubSpot just omits an unknown property rather than erroring --
// so this reads /crm/v3/properties/companies and matches labels, with
// candidate internal names tried first as a fast path.
//
// `tone` drives the chip color client-side. `emphasis: true` marks the tags
// worth showing in the table's narrow Tags column; everything else is
// detail-panel only, so the table doesn't turn into a wall of chips.
export interface CompanyTagSpec {
  key: string;
  label: string;
  candidateNames: string[];
  matchLabels: string[];
  tone: "tier" | "positive" | "neutral" | "warm";
  emphasis: boolean;
  // Suppresses low-signal values -- e.g. a QL-score count of 0, or an
  // explicit "not a target account", carry no differentiation.
  hideValues?: string[];
  // Renders as "<label>: <value>" instead of just the value, for
  // properties whose value alone is ambiguous out of context.
  prefixLabel?: boolean;
  // For numeric properties: only tag when the number is greater than this.
  minNumeric?: number;
}

export const COMPANY_TAG_SPECS: CompanyTagSpec[] = [
  {
    key: "icpTier",
    label: "ICP tier",
    candidateNames: ["ideal_customer_profile_tier", "icp_tier", "customer_profile_tier"],
    matchLabels: ["ideal customer profile tier", "icp tier"],
    tone: "tier",
    emphasis: true,
    hideValues: ["", "none", "n/a", "unknown"],
  },
  {
    key: "targetAccount",
    label: "Target account",
    candidateNames: ["target_account", "is_target_account"],
    matchLabels: ["target account"],
    tone: "positive",
    emphasis: true,
    // "No"/false is the default state for most records -- only the
    // affirmative case is a differentiator worth a chip.
    hideValues: ["", "no", "false", "none", "n/a"],
  },
  {
    key: "accountProfile",
    label: "Account profile",
    candidateNames: ["account_profile"],
    matchLabels: ["account profile"],
    tone: "neutral",
    emphasis: true,
    hideValues: ["", "none", "n/a", "unknown"],
  },
  {
    key: "lifecycleStage",
    label: "Lifecycle",
    candidateNames: ["lifecyclestage"],
    matchLabels: ["lifecycle stage"],
    tone: "neutral",
    emphasis: true,
    hideValues: ["", "none", "n/a"],
  },
  {
    key: "qlContacts",
    label: "QL 7+ contacts",
    candidateNames: ["n__of_contacts_with_ql_score_7_", "num_contacts_ql_score_7"],
    matchLabels: ["# of contacts with ql score 7+", "number of contacts with ql score 7+"],
    tone: "positive",
    emphasis: true,
    prefixLabel: true,
    minNumeric: 0,
  },
  {
    key: "partnerReferred",
    label: "Partner referred",
    candidateNames: ["partner_referred_", "partner_referred"],
    matchLabels: ["partner referred?", "partner referred"],
    tone: "warm",
    emphasis: true,
    hideValues: ["", "no", "false", "none", "n/a"],
  },
  {
    key: "abxProgram",
    label: "ABX program",
    candidateNames: ["abx_program_type"],
    matchLabels: ["abx program type"],
    tone: "neutral",
    emphasis: false,
    hideValues: ["", "none", "n/a"],
  },
  {
    key: "caeLevel",
    label: "CAE/EAE",
    candidateNames: ["cae_eae_level", "cae_level"],
    matchLabels: ["cae/eae level", "cae eae level"],
    tone: "neutral",
    emphasis: false,
    hideValues: ["", "none", "n/a"],
  },
  {
    key: "territory",
    label: "Territory",
    candidateNames: ["territory"],
    matchLabels: ["territory"],
    tone: "neutral",
    emphasis: false,
    hideValues: ["", "none", "n/a"],
  },
  {
    key: "globalRegion",
    label: "Region",
    candidateNames: ["global_region"],
    matchLabels: ["global region"],
    tone: "neutral",
    emphasis: false,
    hideValues: ["", "none", "n/a"],
  },
];

export interface CompanyTag {
  key: string;
  label: string;
  value: string;
  tone: CompanyTagSpec["tone"];
  emphasis: boolean;
}

interface HubSpotPropertyDef {
  name?: string;
  label?: string;
  options?: Array<{ value?: string; label?: string }>;
}

export interface ResolvedTagProperty {
  spec: CompanyTagSpec;
  propertyName: string;
  // Enumeration properties store an internal value ("tier_1") but display a
  // label ("Tier 1") -- keep the map so tags show what HubSpot's UI shows.
  optionLabels: Map<string, string>;
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

// Resolves each tag spec to a real property on THIS portal. Returns only
// the specs that actually exist, so a portal missing some of these custom
// properties simply shows fewer tags instead of erroring.
export async function resolveCompanyTagProperties(): Promise<ResolvedTagProperty[]> {
  let defs: HubSpotPropertyDef[] = [];
  try {
    const res = (await hubspotFetch("/crm/v3/properties/companies")) as { results?: HubSpotPropertyDef[] };
    defs = res.results ?? [];
  } catch {
    return []; // best-effort -- no tags rather than a broken accounts page
  }

  const byName = new Map<string, HubSpotPropertyDef>();
  const byLabel = new Map<string, HubSpotPropertyDef>();
  for (const d of defs) {
    if (d.name) byName.set(d.name, d);
    if (d.label) byLabel.set(normalizeLabel(d.label), d);
  }

  const resolved: ResolvedTagProperty[] = [];
  for (const spec of COMPANY_TAG_SPECS) {
    let def: HubSpotPropertyDef | undefined;
    for (const candidate of spec.candidateNames) {
      const hit = byName.get(candidate);
      if (hit) { def = hit; break; }
    }
    if (!def) {
      for (const label of spec.matchLabels) {
        const hit = byLabel.get(normalizeLabel(label));
        if (hit) { def = hit; break; }
      }
    }
    if (!def?.name) continue;

    const optionLabels = new Map<string, string>();
    for (const opt of def.options ?? []) {
      if (opt.value && opt.label) optionLabels.set(opt.value, opt.label);
    }
    resolved.push({ spec, propertyName: def.name, optionLabels });
  }
  return resolved;
}

// Turns one company's raw property bag into display-ready tags.
export function buildCompanyTags(
  properties: Record<string, string | undefined>,
  resolved: ResolvedTagProperty[],
): CompanyTag[] {
  const tags: CompanyTag[] = [];
  for (const { spec, propertyName, optionLabels } of resolved) {
    const raw = properties[propertyName];
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (!value) continue;

    if (spec.minNumeric !== undefined) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= spec.minNumeric) continue;
    }
    if (spec.hideValues?.includes(value.toLowerCase())) continue;

    const display = optionLabels.get(value) ?? value;
    tags.push({
      key: spec.key,
      label: spec.label,
      value: spec.prefixLabel ? `${spec.label}: ${display}` : display,
      tone: spec.tone,
      emphasis: spec.emphasis,
    });
  }
  return tags;
}
