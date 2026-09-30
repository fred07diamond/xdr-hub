import type { AssessmentInput } from "../assessment/index.js";
import { isWithinWorkingHours, type WorkingHours } from "../clocks/index.js";
import type { CrmOwner, CrmSnapshot } from "../crm/port.js";
import type {
  OwnerSource,
  PrecheckOutcome,
  RelationshipState,
  Route,
} from "../objects/index.js";
import { isTodo, rule, uniqueCitations } from "../playbook/resolve.js";
import type { Citation, PlaybookRelease } from "../playbook/schema.js";
import type { OpenItem, PrecheckResult } from "../precheck/index.js";
import { checkOwnership } from "../precheck/index.js";

export interface RoutingProfile {
  id: string;
  email: string;
  displayName: string;
  workingHours: WorkingHours;
  inRoundRobin: boolean;
}

export interface RouteOwner {
  profileId: string | null;
  email: string;
  displayName: string | null;
}

export interface RouteStepEvaluation {
  step: string;
  matched: boolean;
  detail: string;
}

export interface RoutingResult {
  route: Route;
  relationshipState: RelationshipState;
  owner: RouteOwner | null;
  ownerSource: OwnerSource | null;
  reasonCode: string;
  reason: string;
  evaluated: RouteStepEvaluation[];
  openItems: OpenItem[];
  citations: Citation[];
  pool: {
    source: "release" | "synthetic_dev_pool" | "none";
    members: string[];
  };
}

export function relationshipStateFor(input: {
  snapshot: CrmSnapshot;
  assessment: AssessmentInput;
  accountAgencyFlag: boolean;
  staleDays: number;
  now: Date;
}): { state: RelationshipState; basis: string } {
  const ownership = checkOwnership(input.snapshot, input.staleDays, input.now);
  if (ownership.owned) return { state: "owned", basis: ownership.basis };
  const deals = input.snapshot.openDeals.length;
  if (deals > 0) {
    return {
      state: "open_deal",
      basis: `${deals} open deal${deals === 1 ? "" : "s"} in the CRM`,
    };
  }
  const customer =
    input.snapshot.contact?.isCustomer || input.snapshot.company?.isCustomer;
  if (customer)
    return {
      state: "customer",
      basis: "CRM marks the contact or company as a customer",
    };
  if (input.snapshot.contact?.isChurned)
    return { state: "churned", basis: "CRM marks the contact as churned" };
  if (input.assessment.agency_signal || input.accountAgencyFlag) {
    return {
      state: "agency",
      basis: input.assessment.agency_signal
        ? "The message says they are evaluating for a client"
        : "The account is flagged as an agency",
    };
  }
  return { state: "new", basis: "No owner, deal, customer, or agency signal" };
}

const SETTLED_ROUTES: Partial<
  Record<
    PrecheckOutcome,
    {
      route: Route;
      code: string;
      reason: string;
      ownerSource: OwnerSource | null;
    }
  >
> = {
  route_to_support: {
    route: "support",
    code: "support_request",
    reason: "Support request, routed to support. No sales owner.",
    ownerSource: "support_queue",
  },
  self_serve_thank_you: {
    route: "none",
    code: "educational",
    reason: "Educational request. Self-serve thank-you, template ships in M2.",
    ownerSource: null,
  },
  ignore_logged: {
    route: "none",
    code: "ignored",
    reason:
      "Selling to us or junk. Ignored and logged for the weekly spot check.",
    ownerSource: null,
  },
  disqualify_logged: {
    route: "none",
    code: "restricted_country",
    reason: "Restricted country. Disqualified and logged.",
    ownerSource: null,
  },
};

function ownerFrom(
  crmOwner: CrmOwner | null,
  profiles: RoutingProfile[],
): RouteOwner | null {
  if (!crmOwner) return null;
  const profile = profiles.find(
    (item) => item.email === crmOwner.email.toLowerCase(),
  );
  return {
    profileId: profile?.id ?? null,
    email: crmOwner.email.toLowerCase(),
    displayName: profile?.displayName ?? crmOwner.name,
  };
}

export function pickRoundRobin(input: {
  pool: string[];
  profiles: RoutingProfile[];
  assignmentCounts: Record<string, number>;
  now: Date;
}): { owner: RoutingProfile | null; detail: string; invalid: string[] } {
  const pooled = input.pool
    .map((email) =>
      input.profiles.find((profile) => profile.email === email.toLowerCase()),
    )
    .filter((profile): profile is RoutingProfile =>
      Boolean(profile?.inRoundRobin),
    );
  // A profile whose working hours cannot be evaluated (no working days, an
  // unknown time zone, hours that never resolve) is left out, so one bad
  // profile never blocks every unowned lead.
  const invalid: string[] = [];
  const hoursNow = new Map<string, boolean>();
  for (const profile of pooled) {
    try {
      hoursNow.set(
        profile.id,
        isWithinWorkingHours(input.now, profile.workingHours),
      );
    } catch {
      invalid.push(profile.email);
    }
  }
  const members = pooled.filter((profile) => hoursNow.has(profile.id));
  if (members.length === 0) {
    return {
      owner: null,
      detail:
        invalid.length > 0
          ? "Every pool member has working hours that cannot be evaluated"
          : "No pool member has a round-robin profile",
      invalid,
    };
  }
  const inHours = members.filter((profile) => hoursNow.get(profile.id));
  const candidates = inHours.length > 0 ? inHours : members;
  const ranked = [...candidates].sort((a, b) => {
    const diff =
      (input.assignmentCounts[a.id] ?? 0) - (input.assignmentCounts[b.id] ?? 0);
    return diff !== 0 ? diff : members.indexOf(a) - members.indexOf(b);
  });
  const owner = ranked[0];
  const detail =
    inHours.length > 0
      ? `${owner.displayName} is in working hours with the fewest round-robin leads`
      : `Nobody in the pool is in working hours; ${owner.displayName} has the fewest round-robin leads and their clock starts at their next working hour`;
  return { owner, detail, invalid };
}

export function routeEngagement(input: {
  release: PlaybookRelease;
  precheck: PrecheckResult;
  assessment: AssessmentInput;
  snapshot: CrmSnapshot;
  accountAgencyFlag: boolean;
  profiles: RoutingProfile[];
  assignmentCounts: Record<string, number>;
  devPool: string[];
  now: Date;
}): RoutingResult {
  const order = rule(input.release, "rule.routing.order");
  const stale = rule(input.release, "rule.routing.sal_stale_days");
  const citations: Citation[] = [
    order.citation,
    stale.citation,
    ...input.precheck.citations,
  ];
  const openItems: OpenItem[] = [];
  const evaluated: RouteStepEvaluation[] = [];
  const relationship = relationshipStateFor({
    snapshot: input.snapshot,
    assessment: input.assessment,
    accountAgencyFlag: input.accountAgencyFlag,
    staleDays: stale.params.days,
    now: input.now,
  });
  const releasePool = input.release.config.routing_pool.pool;
  const pool =
    releasePool.length > 0
      ? { source: "release" as const, members: releasePool }
      : input.devPool.length > 0
        ? { source: "synthetic_dev_pool" as const, members: input.devPool }
        : { source: "none" as const, members: [] };

  const base = {
    relationshipState: relationship.state,
    openItems,
    evaluated,
    pool,
  };
  const settled = SETTLED_ROUTES[input.precheck.outcome];
  if (settled) {
    return {
      ...base,
      route: settled.route,
      owner: null,
      ownerSource: settled.ownerSource,
      reasonCode: settled.code,
      reason: settled.reason,
      citations: uniqueCitations(citations),
    };
  }

  // SPEC 6 and FR-5: owners are chosen by rule.routing.order, whichever
  // pre-check signal matched. For attach_to_owner only the CRM steps apply: a
  // lead with an owner in the CRM is never round-robined (G3).
  const ownership = checkOwnership(
    input.snapshot,
    stale.params.days,
    input.now,
  );
  const attachOnly = input.precheck.outcome === "attach_to_owner";
  const dealOwner =
    input.snapshot.openDeals.find((deal) => deal.owner)?.owner ?? null;
  const isCustomer = Boolean(
    input.snapshot.contact?.isCustomer || input.snapshot.company?.isCustomer,
  );
  const customerOwner = isCustomer
    ? (input.snapshot.company?.owner ?? input.snapshot.contact?.owner ?? null)
    : null;

  // An owner that is owned only provisionally still beats every non-CRM step:
  // a lead with a CRM owner is never round-robined (G3).
  const provisionalRoute = (): RoutingResult | null => {
    if (!ownership.owned || !ownership.provisional || !ownership.owner)
      return null;
    evaluated.push({
      step: "existing_active_owner",
      matched: true,
      detail: `${ownership.basis} (provisional)`,
    });
    return {
      ...base,
      route: "existing_active_owner",
      owner: ownerFrom(ownership.owner, input.profiles),
      ownerSource: "crm_contact_owner",
      reasonCode: "owned_contact_unconfirmed",
      reason:
        "Owner in the CRM with unconfirmed activity, routed to that owner",
      citations: uniqueCitations(citations),
    };
  };

  for (const step of order.params.order) {
    if (step !== "existing_active_owner" && step !== "deal_or_customer_owner") {
      const held = provisionalRoute();
      if (held) return held;
    }
    if (step === "existing_active_owner") {
      const active = ownership.owned && !ownership.provisional;
      evaluated.push({ step, matched: active, detail: ownership.basis });
      if (active && ownership.owner) {
        const viaCompany = ownership.via === "company";
        return {
          ...base,
          route: step,
          owner: ownerFrom(ownership.owner, input.profiles),
          ownerSource: viaCompany ? "crm_company_owner" : "crm_contact_owner",
          reasonCode: viaCompany ? "owned_account" : "owned_contact",
          reason: viaCompany
            ? "Owned account, routed to the account owner"
            : `Already ${input.snapshot.contact?.lifecycleRaw ?? "owned"}, routed to its current owner`,
          citations: uniqueCitations(citations),
        };
      }
    } else if (step === "deal_or_customer_owner") {
      const owner = dealOwner ?? customerOwner;
      evaluated.push({
        step,
        matched: Boolean(owner),
        detail: owner
          ? `Owner ${owner.email}`
          : "No open deal owner or customer owner",
      });
      if (owner) {
        return {
          ...base,
          route: step,
          owner: ownerFrom(owner, input.profiles),
          ownerSource: dealOwner ? "crm_deal_owner" : "crm_customer_owner",
          reasonCode: dealOwner ? "open_deal" : "customer",
          reason: dealOwner
            ? "Open deal in progress, routed to the deal owner"
            : "Existing customer, routed to the customer owner",
          citations: uniqueCitations(citations),
        };
      }
    } else if (attachOnly) {
      evaluated.push({
        step,
        matched: false,
        detail:
          "Skipped: the pre-check attaches this lead to an existing CRM owner",
      });
      continue;
    } else if (step === "agency_partner_rep") {
      const isAgency =
        input.assessment.agency_signal || input.accountAgencyFlag;
      const rep = order.params.agency_partner_rep;
      if (!isAgency) {
        evaluated.push({ step, matched: false, detail: "No agency signal" });
        continue;
      }
      const repProfile = isTodo(rep)
        ? undefined
        : input.profiles.find((profile) => profile.email === rep.toLowerCase());
      if (!repProfile) {
        evaluated.push({
          step,
          matched: false,
          detail: "Agency signal present, but no partner rep is set",
        });
        openItems.push({
          code: "agency_partner_rep_unset",
          detail:
            "rule.routing.order has no partner rep yet, so this agency lead fell through to round robin.",
          entry: order.citation,
        });
        continue;
      }
      evaluated.push({
        step,
        matched: true,
        detail: `Partner rep ${repProfile.displayName}`,
      });
      return {
        ...base,
        route: step,
        owner: {
          profileId: repProfile.id,
          email: repProfile.email,
          displayName: repProfile.displayName,
        },
        ownerSource: "partner_rep",
        reasonCode: "agency",
        reason: input.assessment.end_client_named
          ? "Agency for a named client, routed to the partner rep"
          : "Agency for an unnamed client, routed to the partner rep",
        citations: uniqueCitations(citations),
      };
    } else if (step === "round_robin") {
      // The CRM already assigned this new lead at intake (D57): in shadow,
      // that assignment is the real one, so PA follows it.
      const assigned =
        input.snapshot.contact?.assignedOwner ??
        input.snapshot.company?.assignedOwner ??
        null;
      if (assigned) {
        evaluated.push({
          step,
          matched: true,
          detail: `Assigned in the CRM for this submission to ${assigned.email}`,
        });
        return {
          ...base,
          route: step,
          owner: ownerFrom(assigned, input.profiles),
          ownerSource: "crm_contact_owner",
          reasonCode: "crm_intake_assignment",
          reason: `New lead, assigned in HubSpot to ${assigned.name ?? assigned.email} for this submission`,
          citations: uniqueCitations(citations),
        };
      }
      if (pool.source === "synthetic_dev_pool") {
        openItems.push({
          code: "routing_pool_empty",
          detail:
            "config/routing-pool.yaml is empty, so round robin used the synthetic dev pool.",
          entry: order.citation,
        });
      }
      const pick = pickRoundRobin({
        pool: pool.members,
        profiles: input.profiles,
        assignmentCounts: input.assignmentCounts,
        now: input.now,
      });
      evaluated.push({
        step,
        matched: Boolean(pick.owner),
        detail: pick.detail,
      });
      for (const email of pick.invalid) {
        openItems.push({
          code: "profile_hours_invalid",
          detail: `${email} is in the round-robin pool, but their working hours cannot be evaluated, so they were skipped.`,
          entry: order.citation,
        });
      }
      if (pick.owner) {
        const fellThrough = openItems.some(
          (item) => item.code === "agency_partner_rep_unset",
        );
        return {
          ...base,
          route: step,
          owner: {
            profileId: pick.owner.id,
            email: pick.owner.email,
            displayName: pick.owner.displayName,
          },
          ownerSource: "round_robin",
          reasonCode: ownership.staleSal ? "stale_sal_reopened" : "round_robin",
          reason: fellThrough
            ? "Agency lead with no partner rep set, assigned by round robin"
            : ownership.staleSal
              ? `Stale SAL, no activity in over ${stale.params.days} days: reopened deliberately and assigned by round robin`
              : "New and unowned, assigned by round robin",
          citations: uniqueCitations(citations),
        };
      }
    } else {
      evaluated.push({
        step,
        matched: false,
        detail: "Unknown routing step in the playbook",
      });
      openItems.push({
        code: "routing_step_unknown",
        detail: `rule.routing.order lists ${step}, which has no routing function.`,
        entry: order.citation,
      });
    }
  }

  const held = provisionalRoute();
  if (held) return held;
  openItems.push({
    code: "no_owner_found",
    detail: attachOnly
      ? "The pre-check attaches this lead to an existing owner, but the CRM names none. It needs a manual assignment and is never round-robined."
      : "No routing step produced an owner. The lead needs a manual assignment.",
    entry: order.citation,
  });
  return {
    ...base,
    route: "none",
    owner: null,
    ownerSource: null,
    reasonCode: "unassigned",
    reason: "No owner found; needs manual assignment",
    citations: uniqueCitations(citations),
  };
}
