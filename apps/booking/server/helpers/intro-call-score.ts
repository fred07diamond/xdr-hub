import type { IntroCallResearch } from "./intro-call-hubspot.js";

export type Product = "content" | "code";
export type PillarLabel = "Confirmed" | "Hypothesis" | "Unknown";
export type Recommendation = "take_call" | "pivot_ae" | "disqualify";
export type MaturityStage = 1 | 2 | 3 | null;

export interface Pillar {
  score: number;
  label: PillarLabel;
  signals: string[];
}

export interface IntroCallScorecard {
  product: Product;
  productSignal: string;
  productNeedsConfirmation: boolean;
  enterpriseNeed: Pillar;
  icpFit: Pillar;
  maturityStage: MaturityStage;
  maturityStageReason: string | null;
  seatMath: { activeUsers: number; overTwentySeatCap: boolean } | null;
  enterpriseFeatureMatches: string[];
  closedLostOverride: { applies: boolean; reason: string | null; dealName: string | null };
  agencySignal: { looksLikeAgency: boolean; evidence: string | null };
  recommendation: Recommendation;
  recommendationReasons: string[];
}

// Any one of these forces Enterprise on Builder Code (Pricing Reference).
// Matched case-insensitively against the verbatim Contact Sales message —
// this is intentionally a fixed keyword list, not model judgment, so the
// same message always produces the same signal.
const ENTERPRISE_FEATURE_KEYWORDS: Array<{ label: string; pattern: RegExp }> = [
  { label: "SSO/SAML", pattern: /\bsso\b|\bsaml\b/i },
  { label: "RBAC", pattern: /\brbac\b|role[- ]based access/i },
  { label: "Privacy mode", pattern: /privacy mode/i },
  { label: "Training opt-out by default", pattern: /training opt-?out/i },
  { label: "Bitbucket/GitLab Enterprise", pattern: /bitbucket enterprise|gitlab enterprise/i },
  { label: "Azure DevOps", pattern: /azure devops/i },
  { label: "Self-hosted/custom git", pattern: /self-?hosted git|custom git/i },
  { label: "Design System Intelligence", pattern: /design system intelligence/i },
  { label: "Faster dev environments", pattern: /faster dev environments?/i },
  { label: "Premium SLAs", pattern: /premium sla/i },
  { label: "Deployed engineering support", pattern: /deployed engineering support|onboarding support/i },
  { label: "Private Slack channel", pattern: /private slack channel/i },
  { label: "Usage metrics API", pattern: /usage metrics api/i },
];

const STAGE_1_KEYWORDS = /\bfigma\b|\bv0\b|\blovable\b|static mock|mockup/i;
const STAGE_2_KEYWORDS = /component library|design token|storybook|code[- ]based prototyp/i;
const STAGE_3_KEYWORDS = /production (repo|codebase)|\bci\/cd\b|pull request|\bPR\b review|governance/i;

const CONTENT_KEYWORDS =
  /\bcms\b|headless cms|landing page|marketing page|publishing workflow|page builder|multi-?(site|brand|region)|localization|a\/b test|strapi|contentful|sanity|storyblok/i;
const CODE_KEYWORDS =
  /\bfigma\b|design-to-code|ai code generation|design system|component library|prototyp|\bide\b|vs ?code|cursor|\breact\b|\bvue\b|next\.?js/i;

const AGENCY_KEYWORDS = /\bagency\b|\bagencies\b|\bconsultancy\b|\bconsultanc(y|ies)\b|our client|a client project|recommend it to my (customer|client)/i;
const AGENCY_INDUSTRY_KEYWORDS = /marketing.*advertising|information technology.*services|consulting/i;

const CLOSED_LOST_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000;
const SELF_SERVE_DECLINE_DETAIL_PATTERN = /no enterprise need|self-?serve sufficient/i;

const PRIMARY_MARKETS = new Set(["united states", "usa", "us", "canada", "united kingdom", "uk", "germany", "france", "netherlands", "sweden", "norway", "denmark", "finland", "australia", "brazil"]);

function countMatches(message: string | null, patterns: Array<{ label: string; pattern: RegExp }>): string[] {
  if (!message) return [];
  return patterns.filter((p) => p.pattern.test(message)).map((p) => p.label);
}

function placeMaturityStage(message: string | null): { stage: MaturityStage; reason: string | null } {
  if (!message) return { stage: null, reason: null };
  if (STAGE_3_KEYWORDS.test(message)) {
    return { stage: 3, reason: "Message names production repo/CI-CD/governance -- Production Prototyping." };
  }
  if (STAGE_2_KEYWORDS.test(message)) {
    return { stage: 2, reason: "Message names a component library or code-based prototyping -- Code-Based Prototyping." };
  }
  if (STAGE_1_KEYWORDS.test(message)) {
    return { stage: 1, reason: "Message names Figma/v0/Lovable-style static prototyping -- Conceptual Prototyping." };
  }
  return { stage: null, reason: null };
}

function identifyProduct(research: IntroCallResearch): { product: Product; signal: string; needsConfirmation: boolean } {
  const spaceKind = research.contact.firstSpaceKind?.trim().toLowerCase();
  if (spaceKind) {
    return spaceKind === "cms"
      ? { product: "content", signal: `first_space_kind = "${spaceKind}" (contact record)`, needsConfirmation: false }
      : { product: "code", signal: `first_space_kind = "${spaceKind}" (contact record)`, needsConfirmation: false };
  }

  const message = research.contact.messageVerbatim;
  const contentHit = CONTENT_KEYWORDS.test(message ?? "");
  const codeHit = CODE_KEYWORDS.test(message ?? "");
  if (contentHit && !codeHit) {
    return { product: "content", signal: "Inferred from message keywords (Content). first_space_kind unset.", needsConfirmation: false };
  }
  if (codeHit && !contentHit) {
    return { product: "code", signal: "Inferred from message keywords (Code). first_space_kind unset.", needsConfirmation: false };
  }
  return {
    product: "code",
    signal: "first_space_kind unset and message doesn't clearly signal Content vs Code -- ask the xDR before proceeding.",
    needsConfirmation: true,
  };
}

function checkClosedLostOverride(research: IntroCallResearch): { applies: boolean; reason: string | null; dealName: string | null } {
  const cutoff = Date.now() - CLOSED_LOST_LOOKBACK_MS;
  for (const deal of research.deals) {
    if (!deal.closeDate) continue;
    const closedAt = new Date(deal.closeDate).getTime();
    if (Number.isNaN(closedAt) || closedAt < cutoff) continue;

    if (deal.closedLostReasonCategory === "Went Self Serve") {
      return { applies: true, reason: `Closed Lost: "Went Self Serve" (${deal.closeDate})`, dealName: deal.name };
    }
    if (deal.closedLostReasonDetail && SELF_SERVE_DECLINE_DETAIL_PATTERN.test(deal.closedLostReasonDetail)) {
      return { applies: true, reason: `Closed Lost detail matches self-serve decline: "${deal.closedLostReasonDetail}"`, dealName: deal.name };
    }
  }
  return { applies: false, reason: null, dealName: null };
}

function checkAgencySignal(research: IntroCallResearch): { looksLikeAgency: boolean; evidence: string | null } {
  const message = research.contact.messageVerbatim ?? "";
  if (AGENCY_KEYWORDS.test(message)) {
    return { looksLikeAgency: true, evidence: "Message references a client/agency relationship." };
  }
  const industry = research.company?.industry ?? "";
  if (AGENCY_INDUSTRY_KEYWORDS.test(industry)) {
    return { looksLikeAgency: true, evidence: `Company industry is "${industry}".` };
  }
  return { looksLikeAgency: false, evidence: null };
}

function scoreEnterpriseNeedCode(research: IntroCallResearch, featureMatches: string[], maturityStage: MaturityStage) {
  const activeUsers = research.activeInAppUserCount;
  const overCap = activeUsers > 20;
  const signals: string[] = [];
  let score = 2;

  if (activeUsers >= 21) {
    score = 9;
    signals.push(`${activeUsers} active in-app users already exceeds the 20-seat Team cap`);
  } else if (activeUsers >= 5) {
    score = Math.max(score, 5);
    signals.push(`${activeUsers} active in-app users (mid-range seat footprint)`);
  } else if (activeUsers >= 1) {
    score = Math.max(score, 4);
  }

  if (featureMatches.length >= 2) {
    score = Math.max(score, 9);
    signals.push(`${featureMatches.length} enterprise-only feature asks: ${featureMatches.join(", ")}`);
  } else if (featureMatches.length === 1) {
    score = Math.max(score, 7);
    signals.push(`Enterprise-only feature ask: ${featureMatches[0]}`);
  }

  if (maturityStage === 2 || maturityStage === 3) {
    score = Math.max(score, 7);
    signals.push(`Maturity stage ${maturityStage} placement corroborates enterprise need`);
  } else if (maturityStage === 1) {
    score = Math.min(score, 3);
  }

  const enterpriseSignalCount = (overCap ? 1 : 0) + featureMatches.length;
  const label: PillarLabel = enterpriseSignalCount >= 2 ? "Confirmed" : signals.length > 0 ? "Hypothesis" : "Unknown";

  return { score, label, signals };
}

function scoreEnterpriseNeedContent(research: IntroCallResearch) {
  const message = research.contact.messageVerbatim ?? "";
  const signals: string[] = [];
  let score = 5;
  let matchCount = 0;

  if (/hundreds|thousands|\b[1-9]\d{2,}\s*pages\b/i.test(message)) {
    score = Math.max(score, 7);
    matchCount++;
    signals.push("Message implies large page volume");
  }
  if (/team of (5|6|7|8|9|\d{2,})|cross-functional/i.test(message)) {
    score = Math.max(score, 7);
    matchCount++;
    signals.push("Message implies a 5+ person cross-functional content team");
  }
  if (/multi-?(site|brand|region)|localization/i.test(message)) {
    score = Math.max(score, 7);
    matchCount++;
    signals.push("Message signals multi-brand/multi-region or localization");
  }
  if (/\bsso\b|\bgovernance\b|approval workflow/i.test(message)) {
    score = Math.max(score, 7);
    matchCount++;
    signals.push("Message signals SSO/governance/workflow needs");
  }
  if (/replatform|migrat|timeline|by q[1-4]|deadline/i.test(message)) {
    score = Math.max(score, 6);
    matchCount++;
    signals.push("Message names a specific initiative with a timeline");
  }
  if (matchCount >= 3) score = Math.max(score, 9);

  const label: PillarLabel = matchCount >= 2 ? "Confirmed" : matchCount === 1 ? "Hypothesis" : "Unknown";
  return { score, label, signals };
}

function scoreIcpFit(research: IntroCallResearch, product: Product, maturityStage: MaturityStage) {
  const employees = research.company?.employeeCount ?? null;
  const activeUsers = research.activeInAppUserCount;
  const signals: string[] = [];
  let score = 3;
  let hasSignal = false;

  if (product === "code") {
    if (employees && employees >= 200) {
      score = Math.max(score, 5);
      hasSignal = true;
      signals.push(`${employees} employees (200+ threshold)`);
    }
    if (activeUsers >= 4) {
      score = Math.max(score, 6);
      hasSignal = true;
      signals.push(`${activeUsers} active engaged users regardless of firmographics`);
    }
    if (maturityStage === 2 || maturityStage === 3) {
      score = Math.max(score, 7);
      hasSignal = true;
      signals.push("Confident stage 2-3 placement is itself ICP evidence");
    }
  } else {
    if (employees && employees >= 50) {
      score = Math.max(score, 6);
      hasSignal = true;
      signals.push(`${employees} employees`);
    }
  }

  const label: PillarLabel = hasSignal ? (score >= 6 ? "Confirmed" : "Hypothesis") : "Unknown";
  return { score, label, signals };
}

function isPrimaryMarket(location: string | null): boolean {
  if (!location) return false;
  const lower = location.toLowerCase();
  return [...PRIMARY_MARKETS].some((m) => lower.includes(m));
}

function decideRecommendation(input: {
  product: Product;
  productNeedsConfirmation: boolean;
  enterpriseNeed: Pillar;
  icpFit: Pillar;
  featureMatches: string[];
  seatMath: { activeUsers: number; overTwentySeatCap: boolean } | null;
  maturityStage: MaturityStage;
  closedLostOverride: { applies: boolean; reason: string | null; dealName: string | null };
  jobTitle: string | null;
  employeeCount: number | null;
  location: string | null;
}): { recommendation: Recommendation; reasons: string[] } {
  const reasons: string[] = [];

  if (input.closedLostOverride.applies) {
    reasons.push(`Closed Lost override applies (${input.closedLostOverride.reason}) -- defaulting to take the call unless the new message shows explicit enterprise-feature language or a seat ask past 20.`);
    if (input.featureMatches.length === 0 && !input.seatMath?.overTwentySeatCap) {
      return { recommendation: "take_call", reasons };
    }
    reasons.push("Override flips back: new message shows enterprise-feature language or a seat ask past 20.");
  }

  if (input.seatMath?.overTwentySeatCap) {
    reasons.push(`${input.seatMath.activeUsers} active users would exceed the 20-seat Team cap.`);
    return { recommendation: "pivot_ae", reasons };
  }

  if (input.featureMatches.length > 0) {
    reasons.push(`Explicit enterprise-only feature ask: ${input.featureMatches.join(", ")}.`);
    return { recommendation: "pivot_ae", reasons };
  }

  if (input.product === "code") {
    const seniorTitle = /\b(director|vp|vice president|head of|chief|cxo|principal|staff)\b/i.test(input.jobTitle ?? "");
    const primary = isPrimaryMarket(input.location);
    if (primary && input.employeeCount !== null) {
      if (input.employeeCount >= 500 && seniorTitle) {
        reasons.push(`${input.employeeCount}+ employees, senior title, primary market.`);
        return { recommendation: "pivot_ae", reasons };
      }
      if (input.employeeCount < 500 && seniorTitle && input.enterpriseNeed.label !== "Unknown") {
        reasons.push("Sub-500 employees but senior title with demonstrated enterprise-need signal.");
        return { recommendation: "pivot_ae", reasons };
      }
    }
    if (input.maturityStage === 2 || input.maturityStage === 3) {
      reasons.push(`Confident stage ${input.maturityStage} placement corroborates escalation.`);
      return { recommendation: "pivot_ae", reasons };
    }
  } else if (input.product === "content") {
    const strongSignalCount = [
      input.enterpriseNeed.label === "Confirmed",
      (input.icpFit.score ?? 0) >= 7,
    ].filter(Boolean).length;
    if (strongSignalCount >= 2 || input.enterpriseNeed.score >= 9) {
      reasons.push("Meets 2 of 3 Content Highly-Qualified criteria (fit score/enterprise scale, detailed initiative, discovery-question coverage).");
      return { recommendation: "pivot_ae", reasons };
    }
  }

  reasons.push("Real but not clearly AE-ready yet -- default to take the call.");
  return { recommendation: "take_call", reasons };
}

export function scoreIntroCallLead(research: IntroCallResearch): IntroCallScorecard {
  const { product, signal: productSignal, needsConfirmation: productNeedsConfirmation } = identifyProduct(research);
  const message = research.contact.messageVerbatim;

  const featureMatches = countMatches(message, ENTERPRISE_FEATURE_KEYWORDS);
  const { stage: maturityStage, reason: maturityStageReason } = product === "code" ? placeMaturityStage(message) : { stage: null, reason: null };

  const seatMath =
    product === "code"
      ? { activeUsers: research.activeInAppUserCount, overTwentySeatCap: research.activeInAppUserCount > 20 }
      : null;

  const enterpriseNeed =
    product === "code"
      ? scoreEnterpriseNeedCode(research, featureMatches, maturityStage)
      : scoreEnterpriseNeedContent(research);

  const icpFit = scoreIcpFit(research, product, maturityStage);
  const closedLostOverride = checkClosedLostOverride(research);
  const agencySignal = checkAgencySignal(research);

  const { recommendation, reasons } = decideRecommendation({
    product,
    productNeedsConfirmation,
    enterpriseNeed,
    icpFit,
    featureMatches,
    seatMath,
    maturityStage,
    closedLostOverride,
    jobTitle: research.contact.jobTitle,
    employeeCount: research.company?.employeeCount ?? null,
    location: research.company?.location ?? research.contact.location,
  });

  return {
    product,
    productSignal,
    productNeedsConfirmation,
    enterpriseNeed,
    icpFit,
    maturityStage,
    maturityStageReason,
    seatMath,
    enterpriseFeatureMatches: featureMatches,
    closedLostOverride,
    agencySignal,
    recommendation,
    recommendationReasons: reasons,
  };
}
