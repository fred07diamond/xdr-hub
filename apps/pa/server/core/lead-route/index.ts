// Lead routing (D66): after a lead is triaged, who takes the meeting. The
// owner (the PA HubSpot assigned) is not the route. The route says whether
// the email carries an AE's meeting link, the PA's own link, or no link yet
// because the PA qualifies first, plus the exits that are not a PA play.
// Pure, so the board, the record, the drafting lint, and tests agree.
import type { PersonRecord } from "../repo/types.js";

export const LEAD_ROUTES = [
  "route_to_ae",
  "pa_meeting",
  "qualify_first",
  "clarify_once",
  "agency",
  "customer_team",
  "deal_ae",
  "partnerships",
  "partnership_recycle",
  "ae_owned",
  "no_sales_email",
] as const;
export type LeadRoute = (typeof LEAD_ROUTES)[number];

/** The routes a PA can pick on a lead; the rest follow from the CRM. */
export const OVERRIDABLE_ROUTES = [
  "route_to_ae",
  "pa_meeting",
  "qualify_first",
  "clarify_once",
] as const satisfies readonly LeadRoute[];

export const LEAD_ROUTE_LABELS: Record<LeadRoute, string> = {
  route_to_ae: "Route to the AE",
  pa_meeting: "PA takes the call",
  qualify_first: "Qualify first",
  clarify_once: "One clarification email",
  agency: "Agency path",
  customer_team: "Their AE and CSM",
  deal_ae: "The deal's AE",
  partnerships: "Route to Partnerships",
  partnership_recycle: "Recycle: partnership ask",
  ae_owned: "Owned by an AE",
  no_sales_email: "No sales email",
};

/** What the email does on each route. */
export const LEAD_ROUTE_EMAIL: Record<LeadRoute, string> = {
  route_to_ae:
    "Loop in the AE (CC'd): name them, say what the meeting is for, then the AE's meeting link on its own line.",
  pa_meeting:
    "Include the PA's meeting link as the ask, with the qualifying questions.",
  qualify_first:
    "Answer what they asked, then one or two questions. No meeting link yet; the answers decide the route.",
  clarify_once:
    "One email asking them to clarify what they need. Not a sequence and no meeting link; with no reply, it recycles.",
  agency:
    "Ask the path question (internal use, a client project, or exploring). No link yet.",
  customer_team:
    "Connect them with their AE and CSM. Not a PA play, no meeting link.",
  deal_ae:
    "An open deal is in progress: introduce the deal's AE with their meeting link.",
  partnerships:
    "Loop in Partnerships (CC'd): name them, say what the call is for, then their meeting link on its own line.",
  partnership_recycle:
    "A partnership ask that is not exceptional. No email; it recycles.",
  ae_owned:
    "Owned by an AE in HubSpot. HubSpot's workflow emails them, so PA does nothing.",
  no_sales_email: "No sales email.",
};

const AE_ROLES = new Set(["ae", "commercial_ae"]);

/** The class-to-route rule the playbook seeds (rule.routing.by_class). */
export const DEFAULT_ROUTE_BY_CLASS: Record<string, LeadRoute> = {
  hq_content: "route_to_ae",
  hq_code: "route_to_ae",
  standard_content: "qualify_first",
  standard_code: "qualify_first",
  content_price_check: "qualify_first",
  agency: "agency",
};

const NOT_SALES = new Set([
  "route_to_support",
  "self_serve_thank_you",
  "ignore_logged",
  "disqualify_logged",
]);

export interface RoutePerson {
  email: string;
  name: string | null;
}

export interface MeetingWith {
  email: string;
  name: string | null;
  role: "ae" | "pa" | "partnerships";
  link: string | null;
}

export interface LeadRouteResult {
  route: LeadRoute;
  label: string;
  email: string;
  reason: string;
  source: "playbook" | "override" | "crm";
  meetingWith: MeetingWith | null;
  /** What is missing to finish the route, for example a meeting link. */
  gaps: string[];
  /** The lead's PA. */
  paOwner: RoutePerson | null;
  /** Commercial or enterprise, from the company's employees (D77). */
  segment: Segment | null;
  /** Who is missing to finish the route, so the lead page can ask once. */
  needs?: "commercial_ae" | "enterprise_ae" | "partnerships" | null;
  /** The enterprise round robin: given and saved, or next up (D78). */
  roundRobin?: "assigned" | "pending" | null;
}

export interface LeadRouteInput {
  precheckOutcome: string | null;
  signal: string | null;
  /** The lead's class (contactSalesClass approach). */
  approach: string | null;
  hasOpenDeal: boolean;
  isCustomer: boolean;
  isAgency: boolean;
  /** The lead's PA: its HubSpot owner. */
  paOwner: RoutePerson | null;
  /** The company's HubSpot owner: the account's AE when it is not a PA. */
  accountOwner: RoutePerson | null;
  dealOwner: RoutePerson | null;
  people: PersonRecord[];
  byClass: Record<string, string>;
  override: string | null;
  /** The class suggests a recycle (no or a very low intent score, D71). */
  suggestRecycle?: boolean;
  /** The company's employees, for the commercial segment (D77). */
  employees?: number | null;
  /** At or under this many employees is a commercial account (playbook). */
  commercialMaxEmployees?: number | null;
  /** They asked to partner with Builder (D81). */
  partnershipAsk?: boolean;
  /** Their tier judged as a company, agency or not, for a partnership ask. */
  partnershipTier?: "exceptional" | "discovery" | null;
  /** The message shows real interest: not thin, not support or junk (D93). */
  genuineInterest?: boolean;
  /** The enterprise round robin (D78): the AE this lead was given, or next up. */
  enterprise?: { assigned: RoutePerson | null; next: RoutePerson | null };
}

export type Segment = "commercial" | "enterprise";

/** Commercial at or under the playbook's line, enterprise above it (D78). */
export function segmentOf(input: {
  employees?: number | null;
  commercialMaxEmployees?: number | null;
}): Segment | null {
  if (input.employees === null || input.employees === undefined) return null;
  if (!input.commercialMaxEmployees) return null;
  return input.employees <= input.commercialMaxEmployees
    ? "commercial"
    : "enterprise";
}

/**
 * The next enterprise AE in the round robin (D78): the one given the fewest
 * leads, then the one given a lead longest ago, then by email.
 */
export function nextEnterpriseAe(
  people: PersonRecord[],
  assignments: Array<{ aeEmail: string; assignedAt: string; method?: string }>,
): RoutePerson | null {
  // A strict rotation (D93): the Enterprise AEs in the order they were added,
  // and each new lead goes to the AE after the one who got the last lead, so
  // everyone gets an equal turn.
  const aes = people
    .filter((person) => person.role === "ae")
    .sort(
      (a, b) =>
        (a.createdAt || "").localeCompare(b.createdAt || "") ||
        a.email.localeCompare(b.email),
    );
  if (aes.length === 0) return null;
  // A refresh's copy of an earlier pick is the same lead, not a new turn.
  const last = assignments
    .filter((item) => item.method !== "carried")
    .sort((a, b) => a.assignedAt.localeCompare(b.assignedAt))
    .slice(-1)[0];
  const at = last
    ? aes.findIndex((ae) => ae.email === last.aeEmail.toLowerCase())
    : -1;
  const pick = aes[(at + 1) % aes.length];
  return { email: pick.email, name: pick.displayName };
}

const nameOf = (person: RoutePerson | PersonRecord) =>
  ("name" in person ? person.name : person.displayName) ?? person.email;

function meetingWith(
  person: RoutePerson,
  role: "ae" | "pa" | "partnerships",
  people: Map<string, PersonRecord>,
  gaps: string[],
): MeetingWith {
  const saved = people.get(person.email.toLowerCase());
  const link = saved?.meetingLink?.trim() || null;
  const name = person.name ?? saved?.displayName ?? null;
  if (!link)
    gaps.push(
      `No meeting link for ${name ?? person.email}. Add it in Settings, Lead routing.`,
    );
  return { email: person.email.toLowerCase(), name, role, link };
}

const isRoute = (value: string | null | undefined): value is LeadRoute =>
  Boolean(value && (LEAD_ROUTES as readonly string[]).includes(value));

/**
 * The AE for an exceptional lead (D78): the AE who owns the account in
 * HubSpot; else, at 8,000 employees or fewer, the commercial AE; else the
 * next enterprise AE in the round robin.
 */
function aeFor(
  input: LeadRouteInput,
  people: Map<string, PersonRecord>,
  gaps: string[],
): {
  ae: RoutePerson | null;
  why: string;
  missing?: "commercial_ae" | "enterprise_ae";
  roundRobin?: "assigned" | "pending";
} {
  const account = input.accountOwner;
  const accountIsPa =
    account &&
    (people.get(account.email.toLowerCase())?.role === "pa" ||
      account.email.toLowerCase() === input.paOwner?.email.toLowerCase());
  if (account && !accountIsPa)
    return { ae: account, why: "the AE who owns the account in HubSpot" };
  const line = (input.commercialMaxEmployees ?? 0).toLocaleString();
  const segment = segmentOf(input);
  if (segment === "commercial") {
    const commercial = [...people.values()]
      .filter((person) => person.role === "commercial_ae")
      .sort((a, b) => a.email.localeCompare(b.email))[0];
    if (commercial)
      return {
        ae: { email: commercial.email, name: commercial.displayName },
        why: `the commercial AE (${line} employees or fewer, no AE owner)`,
      };
    return { ae: null, why: "", missing: "commercial_ae" };
  }
  if (segment === null && input.commercialMaxEmployees)
    gaps.push(
      "Employee count unknown, so it goes to the enterprise round robin. Check the company size.",
    );
  const assigned = input.enterprise?.assigned ?? null;
  if (assigned)
    return {
      ae: assigned,
      why: "the enterprise AE the round robin gave this lead",
      roundRobin: "assigned",
    };
  const next = input.enterprise?.next ?? null;
  if (next)
    return {
      ae: next,
      why: "next up in the enterprise AE round robin",
      roundRobin: "pending",
    };
  return { ae: null, why: "", missing: "enterprise_ae" };
}

export function leadRouteFor(input: LeadRouteInput): LeadRouteResult {
  const people = new Map(
    input.people.map((person) => [person.email.toLowerCase(), person]),
  );
  const gaps: string[] = [];
  const result = (
    route: LeadRoute,
    source: LeadRouteResult["source"],
    reason: string,
    meeting: MeetingWith | null = null,
  ): LeadRouteResult => ({
    route,
    label: LEAD_ROUTE_LABELS[route],
    email: LEAD_ROUTE_EMAIL[route],
    reason,
    source,
    meetingWith: meeting,
    gaps,
    paOwner: input.paOwner,
    segment: segmentOf(input),
    needs: null,
  });

  if (input.precheckOutcome && NOT_SALES.has(input.precheckOutcome))
    return result("no_sales_email", "crm", "Not a sales lead.");
  // Owned by an AE, whatever the class or segment: HubSpot's own workflow
  // emails them, so PA steps back (D80). An owner is an AE when Lead
  // routing has them as an Enterprise or Commercial AE.
  const owner = input.accountOwner;
  const ownerRole = owner
    ? people.get(owner.email.toLowerCase())?.role
    : undefined;
  if (owner && ownerRole && AE_ROLES.has(ownerRole))
    return result(
      "ae_owned",
      "crm",
      `${nameOf(owner)} owns the account in HubSpot. HubSpot's workflow emails them; nothing to do in PA.`,
    );
  // A partnership ask (D81): exceptional goes to Partnerships, anything less
  // recycles.
  if (input.partnershipAsk) {
    if (input.partnershipTier !== "exceptional")
      return result(
        "partnership_recycle",
        "playbook",
        "They asked about a partnership, and the company is not exceptional, so it recycles.",
      );
    const contact = [...people.values()]
      .filter((person) => person.role === "partnerships")
      .sort((a, b) => a.email.localeCompare(b.email))[0];
    if (!contact) {
      gaps.push(
        "No Partnerships contact set. Add one in Settings, Lead routing.",
      );
      return {
        ...result(
          "partnerships",
          "playbook",
          "An exceptional company asking about a partnership.",
        ),
        needs: "partnerships",
      };
    }
    const who = { email: contact.email, name: contact.displayName };
    return result(
      "partnerships",
      "playbook",
      `An exceptional company asking about a partnership. ${nameOf(who)} handles partnerships.`,
      meetingWith(who, "partnerships", people, gaps),
    );
  }
  if (
    owner &&
    !ownerRole &&
    owner.email.toLowerCase() !== input.paOwner?.email.toLowerCase()
  )
    gaps.push(
      `${nameOf(owner)} owns the account in HubSpot but is not set up in Lead routing. If they are an AE, mark them in Settings, Lead routing, and PA steps back.`,
    );
  if (input.hasOpenDeal) {
    const deal = input.dealOwner ?? input.accountOwner;
    return result(
      "deal_ae",
      "crm",
      deal
        ? `Open deal in progress, owned by ${nameOf(deal)}.`
        : "Open deal in progress.",
      deal ? meetingWith(deal, "ae", people, gaps) : null,
    );
  }
  if (input.isCustomer || input.signal === "existing_deal_or_customer")
    return result(
      "customer_team",
      "crm",
      input.accountOwner
        ? `Existing customer. Their AE is ${nameOf(input.accountOwner)}.`
        : "Existing customer.",
    );

  const override = isRoute(input.override) ? input.override : null;
  const fromClass = input.isAgency
    ? "agency"
    : input.approach
      ? input.byClass[input.approach]
      : null;
  // Every unowned enterprise account (over the commercial line) with real
  // interest goes to the Enterprise AE rotation, whatever its tier (D93).
  const enterpriseRotation =
    !override &&
    !input.isAgency &&
    input.genuineInterest === true &&
    segmentOf(input) === "enterprise";
  const recycle =
    !override && !input.isAgency && !enterpriseRotation && input.suggestRecycle;
  const route: LeadRoute =
    override ??
    (enterpriseRotation
      ? "route_to_ae"
      : recycle
        ? "clarify_once"
        : isRoute(fromClass)
          ? fromClass
          : "qualify_first");
  const source = override ? "override" : "playbook";
  const why = override
    ? "Picked by the PA."
    : enterpriseRotation
      ? `An unowned enterprise account (over ${(input.commercialMaxEmployees ?? 0).toLocaleString()} employees) with a real inquiry.`
      : recycle
        ? "No or a very low intent score suggests a recycle, so one email to clarify."
        : input.approach
          ? "From the lead's class and the playbook's routing rule."
          : "No class yet, so qualify first.";

  if (route === "route_to_ae") {
    const { ae, why: whose, missing, roundRobin } = aeFor(input, people, gaps);
    if (!ae) {
      gaps.push(
        missing === "commercial_ae"
          ? "No commercial AE for this commercial account. Set one in Settings, Lead routing."
          : "No enterprise AEs for the round robin. Add one in Settings, Lead routing.",
      );
      return { ...result(route, source, why), needs: missing ?? null };
    }
    return {
      ...result(
        route,
        source,
        `${why} ${nameOf(ae)} is ${whose}.`,
        meetingWith(ae, "ae", people, gaps),
      ),
      roundRobin: roundRobin ?? null,
    };
  }
  if (route === "pa_meeting") {
    if (!input.paOwner) {
      gaps.push("The lead has no PA owner yet.");
      return result(route, source, why);
    }
    return result(
      route,
      source,
      `${why} ${nameOf(input.paOwner)} takes the call.`,
      meetingWith(input.paOwner, "pa", people, gaps),
    );
  }
  return result(route, source, why);
}

const LINK_ROUTES = new Set<LeadRoute>([
  "partnerships",
  "route_to_ae",
  "pa_meeting",
  "deal_ae",
]);

/** The route as the draft lint checks it. */
export function draftRouteOf(route: LeadRouteResult) {
  // The AE, or the Partnerships contact (D81), is looped in on the email.
  const ae =
    (route.meetingWith?.role === "ae" &&
      (route.route === "route_to_ae" || route.route === "deal_ae")) ||
    (route.meetingWith?.role === "partnerships" &&
      route.route === "partnerships")
      ? route.meetingWith
      : null;
  return {
    route: route.route,
    label: route.label,
    needsLink: LINK_ROUTES.has(route.route),
    link: route.meetingWith?.link ?? null,
    // The AE is looped in on the email (D72): CC'd, and named in it.
    cc: ae?.email ?? null,
    aeName: ae?.name ?? null,
  };
}
