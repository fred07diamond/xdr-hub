import type { AssessmentInput } from "../assessment/index.js";
import { isSalOrLater, type CrmOwner, type CrmSnapshot } from "../crm/port.js";
import type { PrecheckOutcome } from "../objects/index.js";
import { rule, uniqueCitations } from "../playbook/resolve.js";
import type { Citation, PlaybookRelease } from "../playbook/schema.js";

export interface OpenItem {
  code: string;
  detail: string;
  entry?: Citation;
}

export interface SignalEvaluation {
  signal: string;
  matched: boolean | null;
  basis: string;
  entry: Citation;
}

export interface PrecheckResult {
  outcome: PrecheckOutcome;
  signal: string | null;
  evaluated: SignalEvaluation[];
  openItems: OpenItem[];
  citations: Citation[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export interface OwnershipCheck {
  owned: boolean;
  basis: string;
  /** The owner that makes the lead owned: the contact owner, else the company owner. */
  owner: CrmOwner | null;
  via: "contact" | "company" | null;
  /**
   * Owned only because an unknown failed closed (activity unknown, lifecycle
   * unmapped). The pre-check still attaches, but routing prefers a confirmed
   * deal or customer owner first.
   */
  provisional: boolean;
  /** SAL or later with an owner, but no activity inside the stale threshold (SPEC 6). */
  staleSal: boolean;
  openItems: OpenItem[];
}

/**
 * SPEC 6: owned means an active contact owner or a company owner. Unknowns
 * fail closed (G3): an SAL with an owner and unknown activity, or a lifecycle
 * value the mapping cannot read, counts as owned and raises an open item,
 * because a cold touch on an owned lead cannot be undone.
 */
export function checkOwnership(
  snapshot: CrmSnapshot,
  staleDays: number,
  now: Date,
): OwnershipCheck {
  const contact = snapshot.contact;
  const company = snapshot.company;
  const openItems: OpenItem[] = [];
  const result = (
    owned: boolean,
    basis: string,
    owner: CrmOwner | null,
    via: OwnershipCheck["via"],
    staleSal = false,
    provisional = false,
  ): OwnershipCheck => ({
    owned,
    basis,
    owner,
    via,
    staleSal,
    provisional,
    openItems,
  });

  if (!contact) {
    openItems.push({
      code: "crm_contact_missing",
      detail:
        "No CRM contact was found for this email, so contact and company ownership could not be checked.",
    });
  }
  const contactOwner = contact?.owner ?? null;
  if (contact && contactOwner) {
    const unmapped =
      contact.lifecycle === null && Boolean(contact.lifecycleRaw);
    if (unmapped) {
      openItems.push({
        code: "lifecycle_unmapped",
        detail: `Lifecycle value ${contact.lifecycleRaw} is not in the mapping, so the owned lead is treated as owned.`,
      });
      return result(
        true,
        `Lifecycle ${contact.lifecycleRaw} is unmapped and the contact has owner ${contactOwner.email}; treated as owned`,
        contactOwner,
        "contact",
        false,
        true,
      );
    }
    if (isSalOrLater(contact.lifecycle)) {
      if (!contact.lastActivityAt) {
        openItems.push({
          code: "sal_activity_unknown",
          detail:
            "The contact is SAL or later with an owner, but last activity is unknown, so it is treated as owned.",
        });
        return result(
          true,
          `${contact.lifecycleRaw} with owner ${contactOwner.email}; last activity unknown, treated as owned`,
          contactOwner,
          "contact",
          false,
          true,
        );
      }
      const days = Math.floor(
        (now.getTime() - new Date(contact.lastActivityAt).getTime()) / DAY_MS,
      );
      if (days <= staleDays) {
        return result(
          true,
          `${contact.lifecycleRaw} with owner ${contactOwner.email}, last activity ${days} days ago (within ${staleDays})`,
          contactOwner,
          "contact",
        );
      }
      if (!company?.owner) {
        return result(
          false,
          `Stale SAL: last activity ${days} days ago, over the ${staleDays} day threshold`,
          null,
          null,
          true,
        );
      }
    }
  }
  if (company?.owner) {
    return result(
      true,
      `Account ${company.name ?? company.domain ?? "unknown"} is owned by ${company.owner.email}`,
      company.owner,
      "company",
    );
  }
  if (!contact) return result(false, "No CRM contact", null, null);
  if (!contactOwner)
    return result(false, "No contact owner and no company owner", null, null);
  return result(
    false,
    `Lifecycle ${contact.lifecycleRaw ?? "unknown"} is before SAL and the account has no owner`,
    null,
    null,
  );
}

const INTENT_SIGNALS: Record<string, string> = {
  support_request: "support",
  educational: "educational",
  selling_to_us: "selling_to_us",
  junk_or_fake: "junk",
};

export function runPrecheck(input: {
  release: PlaybookRelease;
  assessment: AssessmentInput;
  snapshot: CrmSnapshot;
  country: string | null;
  now: Date;
}): PrecheckResult {
  const outcomes = rule(input.release, "rule.precheck.outcomes");
  const restricted = rule(input.release, "rule.precheck.restricted_countries");
  const stale = rule(input.release, "rule.routing.sal_stale_days");
  const evaluated: SignalEvaluation[] = [];
  const openItems: OpenItem[] = [];
  const citations: Citation[] = [outcomes.citation, restricted.citation];

  const countries = restricted.params.countries.map((code) =>
    code.toUpperCase(),
  );
  const country = input.country?.trim().toUpperCase() || null;
  if (countries.length === 0) {
    openItems.push({
      code: "restricted_countries_unconfirmed",
      detail:
        "The restricted country list is empty until RevOps and Legal supply it, so no country is blocked yet.",
      entry: restricted.citation,
    });
  }
  if (!country) {
    openItems.push({
      code: "country_unknown",
      detail:
        "The submission has no country, so the compliance check could not run.",
      entry: restricted.citation,
    });
  }
  const restrictedMatch = country !== null && countries.includes(country);
  evaluated.push({
    signal: "restricted_country",
    matched: country === null ? null : restrictedMatch,
    basis: country
      ? `Country ${country} ${restrictedMatch ? "is" : "is not"} on the restricted list (${countries.length} countries)`
      : "Country not provided",
    entry: restricted.citation,
  });

  if (restrictedMatch) {
    return {
      outcome: outcomes.params.restricted_country ?? "disqualify_logged",
      signal: "restricted_country",
      evaluated,
      openItems,
      citations: uniqueCitations(citations),
    };
  }

  const snapshot = input.snapshot;
  const ownership = checkOwnership(snapshot, stale.params.days, input.now);
  openItems.push(
    ...ownership.openItems.map((item) => ({ ...item, entry: stale.citation })),
  );
  let matchedSignal: string | null = null;

  for (const signal of Object.keys(outcomes.params)) {
    if (signal === "restricted_country") continue;
    let matched: boolean | null;
    let basis: string;
    if (signal in INTENT_SIGNALS) {
      matched = input.assessment.intent === INTENT_SIGNALS[signal];
      basis = `Assessment intent is ${input.assessment.intent}`;
    } else if (signal === "existing_deal_or_customer") {
      const deals = snapshot.openDeals.length;
      const customer = Boolean(
        snapshot.contact?.isCustomer || snapshot.company?.isCustomer,
      );
      matched = deals > 0 || customer;
      basis = `${deals} open deal${deals === 1 ? "" : "s"}; customer ${customer ? "yes" : "no"}`;
    } else if (signal === "owned_account") {
      matched = ownership.owned;
      basis = ownership.basis;
      citations.push(stale.citation);
    } else if (signal === "active_conversation") {
      matched = null;
      basis =
        "Not evaluated: the playbook does not define what counts as an active conversation";
      openItems.push({
        code: "active_conversation_undefined",
        detail:
          "rule.precheck.outcomes maps active_conversation, but no threshold is defined, so it was not evaluated.",
        entry: outcomes.citation,
      });
    } else {
      matched = null;
      basis = "Not evaluated: no rule function exists for this signal";
      openItems.push({
        code: "signal_without_rule_function",
        detail: `Signal ${signal} has no rule function in code.`,
        entry: outcomes.citation,
      });
    }
    evaluated.push({ signal, matched, basis, entry: outcomes.citation });
    if (matched === true && matchedSignal === null) matchedSignal = signal;
  }

  const mappedIntents = new Set(Object.values(INTENT_SIGNALS));
  if (
    !["sales", "other"].includes(input.assessment.intent) &&
    !mappedIntents.has(input.assessment.intent)
  ) {
    openItems.push({
      code: "intent_without_mapping",
      detail: `Assessment intent ${input.assessment.intent} has no pre-check outcome in the playbook.`,
      entry: outcomes.citation,
    });
  }
  openItems.push({
    code: "undeliverable_email_unmapped",
    detail:
      "PRD FR-3 lists undeliverable email, but the playbook has no outcome for it, so deliverability was not checked.",
    entry: outcomes.citation,
  });
  const openWorkPolicy = outcomes.entry.extra?.open_work_policy;
  if (openWorkPolicy !== undefined) {
    openItems.push({
      code: "open_work_policy_undefined",
      detail: `open_work_policy is set to ${String(openWorkPolicy)}, but its meaning is not defined, so it was not applied.`,
      entry: outcomes.citation,
    });
  }

  const outcome: PrecheckOutcome = matchedSignal
    ? (outcomes.params[matchedSignal] ?? "continue")
    : "continue";
  return {
    outcome,
    signal: matchedSignal,
    evaluated,
    openItems,
    citations: uniqueCitations(citations),
  };
}
