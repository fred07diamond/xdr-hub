// One lead's route from what the pipeline recorded: the pre-check, the CRM
// snapshot, the owner, the class, the Team page's people, and any override.
import type { CrmSnapshot } from "../crm/port.js";
import type { PlaybookRelease } from "../playbook/schema.js";
import {
  contactSalesClass,
  isPartnershipAsk,
  qualifyThresholds,
  type ContactSalesClass,
} from "../qualify/index.js";
import type {
  AssessmentRecord,
  EngagementRecord,
  PaRepository,
  PersonRecord,
  RouteOverrideRecord,
  AeAssignmentRecord,
  SubmissionRecord,
} from "../repo/types.js";
import type { RoutingResult } from "../routing/index.js";
import {
  DEFAULT_ROUTE_BY_CLASS,
  leadRouteFor,
  nextEnterpriseAe,
  type LeadRouteResult,
  type RoutePerson,
} from "./index.js";

const fieldOf = (fields: Record<string, unknown> | undefined, key: string) => {
  const value = fields?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const numberOf = (value: string | null) => {
  const parsed = value === null ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** "201-500" or "5,000+" to its lower bound, conservative for the 2,000 line. */
const lowerBound = (value: string | null) => {
  const match = value?.replace(/,/g, "").match(/\d+/);
  return match ? Number(match[0]) : null;
};

/** The Contact Sales class for a submission (D61, D67). */
export function classOfSubmission(input: {
  submission: SubmissionRecord | null | undefined;
  assessment: AssessmentRecord | null | undefined;
  snapshot: Partial<CrmSnapshot> | null | undefined;
  release?: PlaybookRelease | null;
  skipAgency?: boolean;
}): ContactSalesClass {
  const fields = input.submission?.fields;
  const company = input.snapshot?.company ?? null;
  return contactSalesClass({
    message: input.submission?.message ?? null,
    useCase: fieldOf(fields, "use_case"),
    jobTitle: fieldOf(fields, "job_title"),
    breeze: numberOf(fieldOf(fields, "breeze_fit_score")),
    employees:
      company?.employees ?? lowerBound(fieldOf(fields, "company_size")),
    annualRevenue: company?.annualRevenue ?? null,
    productInterest: input.assessment?.productInterest ?? null,
    agencySignal: Boolean(input.assessment?.agencySignal),
    budgetStatus: fieldOf(fields, "budget_status"),
    signupContacts: company?.signupContacts ?? null,
    thresholds: qualifyThresholds(input.release),
    skipAgency: input.skipAgency,
  });
}

/** The lead's round robin AE if it has one, and who is next up (D78). */
async function enterpriseOf(
  repo: PaRepository,
  engagement: EngagementRecord,
  people: PersonRecord[],
  preloaded?: AeAssignmentRecord[],
) {
  const assignments = preloaded ?? (await repo.listAeAssignments());
  const mine = assignments.find((item) => item.engagementId === engagement.id);
  const saved = mine
    ? people.find((person) => person.email === mine.aeEmail.toLowerCase())
    : null;
  return {
    assigned: mine
      ? { email: mine.aeEmail, name: saved?.displayName ?? null }
      : null,
    next: mine ? null : nextEnterpriseAe(people, assignments),
  };
}

/** The commercial line when the active playbook has no block for it yet. */
export const DEFAULT_COMMERCIAL_MAX_EMPLOYEES = 8000;

/** The playbook's commercial line (D77): under this many employees. */
export function commercialLine(release: PlaybookRelease): number | null {
  const entry = release.entries.find(
    (item) => item.id === "rule.routing.commercial",
  );
  // A release published before the block existed still uses the line Fred
  // set; retiring the block turns commercial routing off.
  if (!entry) return DEFAULT_COMMERCIAL_MAX_EMPLOYEES;
  if (entry.status === "retired") return null;
  const value = (entry.params as Record<string, unknown> | undefined)
    ?.max_employees;
  return typeof value === "number" && value > 0 ? value : null;
}

/** The playbook's class-to-route rule, or the seed default. */
export function routeByClass(release: PlaybookRelease): Record<string, string> {
  const entry = release.entries.find(
    (item) => item.id === "rule.routing.by_class",
  );
  const params = (entry?.params ?? null) as Record<string, unknown> | null;
  if (!params || entry?.status === "retired") return DEFAULT_ROUTE_BY_CLASS;
  return Object.fromEntries(
    Object.entries({ ...DEFAULT_ROUTE_BY_CLASS, ...params }).filter(
      ([, value]) => typeof value === "string",
    ),
  ) as Record<string, string>;
}

const person = (
  owner:
    | { email: string; name?: string | null; displayName?: string | null }
    | null
    | undefined,
): RoutePerson | null =>
  owner?.email
    ? {
        email: owner.email.toLowerCase(),
        name: owner.displayName ?? owner.name ?? null,
      }
    : null;

export async function routeForEngagement(
  repo: PaRepository,
  release: PlaybookRelease,
  engagement: EngagementRecord,
  preload: {
    people?: PersonRecord[];
    override?: RouteOverrideRecord | null;
    assignments?: AeAssignmentRecord[];
  } = {},
): Promise<
  LeadRouteResult & { classLabel: string | null; approach: string | null }
> {
  const submissions = await repo.listSubmissionsForEngagement(engagement.id);
  const latest = submissions[submissions.length - 1];
  const [
    assessment,
    precheck,
    snapshotReceipt,
    routeReceipt,
    people,
    override,
  ] = await Promise.all([
    latest ? repo.getAssessmentForSubmission(latest.id) : null,
    latest ? repo.findReceipt("precheck", latest.id) : null,
    latest ? repo.findReceipt("crm_snapshot", latest.id) : null,
    latest ? repo.findReceipt("route", latest.id) : null,
    preload.people ?? repo.listPeople(),
    preload.override !== undefined
      ? preload.override
      : repo.getRouteOverride(engagement.id),
  ]);
  const snapshot = (snapshotReceipt?.ruleResults.snapshot ??
    null) as Partial<CrmSnapshot> | null;
  const routing = routeReceipt?.ruleResults.routing as
    | RoutingResult
    | undefined;
  const precheckOutcome =
    (precheck?.ruleResults.outcome as string | undefined) ?? null;
  const salesLead =
    Boolean(precheckOutcome) &&
    ![
      "route_to_support",
      "self_serve_thank_you",
      "ignore_logged",
      "disqualify_logged",
    ].includes(precheckOutcome!);
  const cls = salesLead
    ? classOfSubmission({ submission: latest, assessment, snapshot, release })
    : null;
  const dealOwner =
    (snapshot?.openDeals ?? []).find((deal) => deal.owner)?.owner ?? null;
  const route = leadRouteFor({
    precheckOutcome,
    signal: (precheck?.ruleResults.signal as string | null) ?? null,
    approach: cls?.approach ?? null,
    hasOpenDeal: (snapshot?.openDeals ?? []).length > 0,
    isCustomer: Boolean(
      snapshot?.contact?.isCustomer || snapshot?.company?.isCustomer,
    ),
    isAgency: Boolean(assessment?.agencySignal) || cls?.approach === "agency",
    paOwner: person(routing?.owner),
    accountOwner: person(snapshot?.company?.owner),
    dealOwner: person(dealOwner),
    people,
    byClass: routeByClass(release),
    override: override?.route ?? null,
    suggestRecycle: Boolean(cls?.suggestRecycle),
    partnershipAsk: isPartnershipAsk(latest?.message),
    partnershipTier: isPartnershipAsk(latest?.message)
      ? classOfSubmission({
          submission: latest,
          assessment,
          snapshot,
          release,
          skipAgency: true,
        }).tier
      : null,
    employees:
      snapshot?.company?.employees ??
      lowerBound(fieldOf(latest?.fields, "company_size")),
    commercialMaxEmployees: commercialLine(release),
    enterprise: await enterpriseOf(
      repo,
      engagement,
      people,
      preload.assignments,
    ),
  });
  return {
    ...route,
    classLabel: cls?.label ?? null,
    approach: cls?.approach ?? null,
  };
}
