// What code can enforce (D44). The playbook can say anything; this manifest is
// the app's honest account of which rules, params, steps, and CRM fields code
// actually reads. The checks compare every change against it, so a rule code
// cannot evaluate is never published as if it were enforced.
import type { z } from "zod";

import { CANONICAL_FIELDS } from "../../../shared/crm-mapping.js";
import { ruleParamSchemas, type RuleId } from "./resolve.js";

/**
 * Canonical CRM fields the CRM port exposes (SPEC 10). `mapping` is the path
 * in `config.hubspot_mapping` that names the HubSpot property, or null for a
 * standard HubSpot object or property that needs no mapping.
 */
export const CANONICAL_CRM_FIELDS: Record<
  string,
  { label: string; mapping: string | null }
> = Object.fromEntries(
  CANONICAL_FIELDS.map((field) => [
    field.key,
    { label: field.label, mapping: field.mapping },
  ]),
);

export interface Evaluator {
  paramSchema: z.ZodType;
  /** Top-level param keys code reads. Others are stored but not enforced. */
  reads: readonly string[];
  /** Values code branches on inside a param, when it has a closed set. */
  knownValues?: Record<string, readonly string[]>;
  crmFields: readonly string[];
  summary: string;
  /**
   * Values of a string param that code supports. Anything else publishes, but
   * raises a feature suggestion (for example a CRM with no adapter yet).
   */
  supported?: Record<string, readonly string[]>;
}

const PRECHECK_SIGNALS = [
  "support_request",
  "educational",
  "selling_to_us",
  "junk_or_fake",
  "existing_deal_or_customer",
  "owned_account",
  "restricted_country",
] as const;

// Keep in step with server/core/precheck, routing, scorecard, and pipeline.
export const EVALUATORS: Record<RuleId, Evaluator> = {
  "rule.precheck.outcomes": {
    paramSchema: ruleParamSchemas["rule.precheck.outcomes"],
    reads: [...PRECHECK_SIGNALS, "active_conversation"],
    knownValues: { signals: PRECHECK_SIGNALS },
    crmFields: [
      "contact.owner",
      "contact.lifecycle",
      "contact.sal_value",
      "contact.last_activity",
      "contact.is_customer",
      "company.owner",
      "company.is_customer",
      "deal.open",
    ],
    summary: "Pre-check signals in declared order, each mapped to an outcome",
  },
  "rule.precheck.restricted_countries": {
    paramSchema: ruleParamSchemas["rule.precheck.restricted_countries"],
    reads: ["countries"],
    crmFields: [],
    summary: "Disqualifies submissions from listed ISO country codes",
  },
  "rule.routing.order": {
    paramSchema: ruleParamSchemas["rule.routing.order"],
    reads: ["order", "agency_partner_rep"],
    knownValues: {
      order: [
        "existing_active_owner",
        "deal_or_customer_owner",
        "agency_partner_rep",
        "round_robin",
      ],
    },
    crmFields: [
      "contact.owner",
      "company.owner",
      "deal.owner",
      "contact.is_customer",
      "company.is_customer",
    ],
    summary: "Routing steps in order; the first that yields an owner wins",
  },
  "rule.routing.by_class": {
    paramSchema: ruleParamSchemas["rule.routing.by_class"],
    reads: [
      "hq_content",
      "hq_code",
      "standard_content",
      "standard_code",
      "content_price_check",
      "agency",
    ],
    crmFields: ["company.owner", "deal.owner"],
    summary:
      "After triage, which class goes to the AE, which the PA takes, and which qualifies first",
  },
  "rule.follow_ups.cadence": {
    paramSchema: ruleParamSchemas["rule.follow_ups.cadence"],
    reads: ["route_to_ae", "pa_meeting", "qualify_first", "clarify_once"],
    crmFields: ["contact.lifecycle"],
    summary:
      "After the first touch, the follow-ups the agent writes for each route, and on which day; a reply, a meeting, or a stage change stops them",
  },
  "rule.routing.commercial": {
    paramSchema: ruleParamSchemas["rule.routing.commercial"],
    reads: ["max_employees"],
    crmFields: [],
    summary:
      "With no AE owner: at or under this many employees to the Commercial AE, above it round robin to an Enterprise AE",
  },
  "rule.routing.sal_stale_days": {
    paramSchema: ruleParamSchemas["rule.routing.sal_stale_days"],
    reads: ["days"],
    crmFields: ["contact.lifecycle", "contact.last_activity"],
    summary: "An SAL with no activity in this many days is reopened",
  },
  "rule.sla.first_touch": {
    paramSchema: ruleParamSchemas["rule.sla.first_touch"],
    reads: ["minutes", "reminder_at_fraction"],
    crmFields: [],
    summary: "First-touch clock in the owner's working hours",
  },
  "rule.sla.decision": {
    paramSchema: ruleParamSchemas["rule.sla.decision"],
    reads: ["hours"],
    crmFields: [],
    summary: "QL decision clock",
  },
  "rule.crm.system": {
    paramSchema: ruleParamSchemas["rule.crm.system"],
    reads: ["system"],
    supported: { system: ["hubspot"] },
    crmFields: [],
    summary: "Which CRM adapter the CRM port uses",
  },
  "rule.qualify.tiers": {
    paramSchema: ruleParamSchemas["rule.qualify.tiers"],
    reads: [
      "exceptional_signals",
      "intent_exceptional",
      "intent_recycle",
      "employees_exceptional",
      "signups_multiple",
      "thin_message_words",
    ],
    crmFields: [],
    summary:
      "Exceptional (route to the AE) or Requires discovery, from five signals",
  },
  "rule.enterprise.bar": {
    paramSchema: ruleParamSchemas["rule.enterprise.bar"],
    reads: ["code_min_seats"],
    crmFields: [],
    summary: "Builder Code seats that make a lead enterprise-shaped",
  },
};

export function evaluatorFor(id: string): Evaluator | null {
  return (EVALUATORS as Record<string, Evaluator>)[id] ?? null;
}

/** Entry types the agent reads as guidance; they need no evaluator. */
export const GUIDANCE_TYPES = new Set([
  "definition",
  "message_rule",
  "knowledge",
]);
