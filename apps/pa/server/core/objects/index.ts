export const ENGAGEMENT_STATES = [
  "new",
  "prechecked",
  "routed",
  "awaiting_first_touch",
  "first_touch_sent",
  "replied",
  "meeting_booked",
  "ql",
  "sal",
  "recycled",
  "disqualified",
  "attached",
  "closed",
] as const;
export type EngagementState = (typeof ENGAGEMENT_STATES)[number];

export const STATE_LABELS: Record<EngagementState, string> = {
  new: "New",
  prechecked: "Pre-checked",
  routed: "Routed",
  awaiting_first_touch: "Awaiting first touch",
  first_touch_sent: "First touch sent",
  replied: "Replied",
  meeting_booked: "Meeting booked",
  // The scorecard's read; QL itself is a lifecycle stage (D69).
  ql: "Sales request",
  sal: "SAL",
  recycled: "Recycled",
  disqualified: "Disqualified",
  attached: "Attached",
  closed: "Closed",
};

const CLOSE_PATHS: EngagementState[] = ["recycled", "disqualified", "closed"];

const TRANSITIONS: Record<EngagementState, readonly EngagementState[]> = {
  new: ["prechecked"],
  prechecked: ["routed", "attached", "disqualified", "closed"],
  // ql from routed and attached: the rep accepts in the decision loop (D59).
  routed: ["awaiting_first_touch", "ql", ...CLOSE_PATHS],
  awaiting_first_touch: ["first_touch_sent", "ql", ...CLOSE_PATHS],
  first_touch_sent: ["replied", "meeting_booked", "ql", "sal", ...CLOSE_PATHS],
  replied: ["meeting_booked", "ql", "sal", ...CLOSE_PATHS],
  meeting_booked: ["ql", "sal", ...CLOSE_PATHS],
  ql: ["sal", ...CLOSE_PATHS],
  sal: ["closed"],
  attached: ["first_touch_sent", "ql", ...CLOSE_PATHS],
  recycled: ["closed"],
  disqualified: ["closed"],
  closed: [],
};

export const OPEN_STATES: ReadonlySet<EngagementState> = new Set(
  ENGAGEMENT_STATES.filter(
    (state) => !["recycled", "disqualified", "closed"].includes(state),
  ),
);

export class InvalidTransitionError extends Error {}

export function canTransition(from: EngagementState, to: EngagementState) {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: EngagementState, to: EngagementState) {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(
      `Cannot move an engagement from ${from} to ${to}`,
    );
  }
}

export const RELATIONSHIP_STATES = [
  "owned",
  "open_deal",
  "customer",
  "churned",
  "agency",
  "new",
] as const;
export type RelationshipState = (typeof RELATIONSHIP_STATES)[number];

export const RELATIONSHIP_LABELS: Record<RelationshipState, string> = {
  owned: "Owned",
  open_deal: "Open deal",
  customer: "Customer",
  churned: "Churned",
  agency: "Agency",
  new: "New",
};

export const PRECHECK_OUTCOMES = [
  "attach_to_owner",
  "route_to_support",
  "self_serve_thank_you",
  "ignore_logged",
  "disqualify_logged",
  "continue",
] as const;
export type PrecheckOutcome = (typeof PRECHECK_OUTCOMES)[number];

export const PRECHECK_LABELS: Record<PrecheckOutcome, string> = {
  attach_to_owner: "Attach to existing owner",
  route_to_support: "Route to support",
  self_serve_thank_you: "Self-serve thank-you",
  ignore_logged: "Ignore and log",
  disqualify_logged: "Disqualify and log",
  continue: "Continue",
};

export const ROUTES = [
  "existing_active_owner",
  "deal_or_customer_owner",
  "agency_partner_rep",
  "round_robin",
  "support",
  "none",
] as const;
export type Route = (typeof ROUTES)[number];

export const ROUTE_LABELS: Record<Route, string> = {
  existing_active_owner: "Existing active owner",
  deal_or_customer_owner: "Deal or customer owner",
  agency_partner_rep: "Agency partner rep",
  round_robin: "Round robin",
  support: "Support",
  none: "No route",
};

export const OWNER_SOURCES = [
  "crm_contact_owner",
  "crm_deal_owner",
  "crm_customer_owner",
  "crm_company_owner",
  "partner_rep",
  "round_robin",
  "support_queue",
] as const;
export type OwnerSource = (typeof OWNER_SOURCES)[number];

export const VERDICTS = [
  "ql",
  "recycle",
  "disqualify",
  "attach_existing",
  "route_elsewhere",
] as const;
export type Verdict = (typeof VERDICTS)[number];

export const VERDICT_LABELS: Record<Verdict, string> = {
  ql: "QL",
  recycle: "Recycle",
  disqualify: "Disqualify",
  attach_existing: "Attach to existing",
  route_elsewhere: "Route elsewhere",
};

export const ENGAGEMENT_OUTCOMES = {
  route_to_support: "routed_to_support",
  self_serve_thank_you: "self_serve_thank_you",
  ignore_logged: "ignored_logged",
  disqualify_logged: "disqualified_logged",
} as const;
