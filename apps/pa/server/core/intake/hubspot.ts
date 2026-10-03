// Intake from HubSpot (D5, backstop poll as the main path until the webhook is
// confirmed): recent Contact Sales submissions become inbox rows, one per
// submission. Reads only. The inbox's (source, external_id) key makes a
// re-poll a no-op, so polling more often never creates a second engagement.
import type { HubSpotFetch } from "../crm/hubspot-adapter.js";
import type { InboxRecord, PaRepository } from "../repo/types.js";

export const HUBSPOT_SOURCE = "hubspot";

/** Contact properties read for each submission. Field values are data only. */
export const CONTACT_SALES_PROPERTIES = [
  "email",
  "firstname",
  "lastname",
  "company",
  "country",
  // The contact's time zone, so follow-ups come due in their hours (D103).
  "hs_timezone",
  "jobtitle",
  "message",
  "what_is_your_use_case__contact_sales_",
  "current_tech_stack__contact_sales_questionnaire_",
  "budget_status_for_dev_tools_this_year_",
  "what_is_your_company_size_",
  "company_fit_score___breeze",
  "most_recent_contact_sales_date",
  "most_recently_contact_sales_date__date_time_",
  "form_type",
  "form_intent",
  "recent_conversion_event_name",
  "source_page_url",
  "what_is_your_primary_business_driver___contact_sales_questionnaire_",
  "if_primary_business_driver_is_other___explain__contact_sales_questionnaire_",
  "how_will_you_measure_success___contact_sales_questionnaire_",
  "if_how_you_measure_success_is_other___explain__contact_sales_questionnaire_",
  "who_makes_the_final_call_",
] as const;

/**
 * `most_recent_contact_sales_date` is also set for other forms (a livestream
 * registration, a meetings link), so it only narrows the search. A lead is
 * Contact Sales when the last form was the Sales Demo form (form type
 * "Contact Sales") or its thank-you questionnaire, which only follows it.
 */
const CONTACT_SALES_FORM_TYPES = new Set([
  "contact sales",
  "thank you page questionnaire",
]);

export function isContactSales(props: Record<string, unknown>): {
  ok: boolean;
  reason: string;
} {
  const formType = clean(props.form_type);
  const event = clean(props.recent_conversion_event_name) ?? "";
  if (formType && CONTACT_SALES_FORM_TYPES.has(formType.toLowerCase()))
    return { ok: true, reason: `Form type ${formType}` };
  if (/sales demo form|contact sales thank you page questionnaire/i.test(event))
    return { ok: true, reason: `Recent form ${event}` };
  return {
    ok: false,
    reason: `Not a Contact Sales form submission (last form: ${event || formType || "unknown"})`,
  };
}

/** Form answers kept on the submission, under readable keys. */
const FORM_FIELDS: Record<string, string> = {
  what_is_your_use_case__contact_sales_: "use_case",
  current_tech_stack__contact_sales_questionnaire_: "tech_stack",
  budget_status_for_dev_tools_this_year_: "budget_status",
  what_is_your_company_size_: "company_size",
  company_fit_score___breeze: "breeze_fit_score",
  jobtitle: "job_title",
  what_is_your_primary_business_driver___contact_sales_questionnaire_:
    "business_driver",
  if_primary_business_driver_is_other___explain__contact_sales_questionnaire_:
    "business_driver_detail",
  how_will_you_measure_success___contact_sales_questionnaire_:
    "success_measure",
  if_how_you_measure_success_is_other___explain__contact_sales_questionnaire_:
    "success_measure_detail",
  who_makes_the_final_call_: "decision_maker",
  form_type: "form_type",
  form_intent: "form_intent",
  source_page_url: "source_page_url",
};

export interface ContactSalesSubmission {
  contactId: string;
  submittedAt: string;
  externalId: string;
  payload: Record<string, unknown>;
}

const clean = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/** A date-only property means midnight UTC in HubSpot; the timestamp wins when present. */
function submittedAt(props: Record<string, unknown>): string | null {
  const precise = clean(props.most_recently_contact_sales_date__date_time_);
  const day = clean(props.most_recent_contact_sales_date);
  const raw = precise ?? day;
  if (!raw) return null;
  const parsed = /^\d+$/.test(raw) ? new Date(Number(raw)) : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** The contact's record in HubSpot, when the portal id is known. */
export const crmRecordUrl = (portalId: string | null, contactId: string) =>
  portalId
    ? `https://app.hubspot.com/contacts/${encodeURIComponent(portalId)}/record/0-1/${encodeURIComponent(contactId)}`
    : null;

export function toSubmission(
  raw: {
    id: string;
    properties: Record<string, unknown>;
  },
  portalId: string | null = null,
): ContactSalesSubmission | null {
  const props = raw.properties;
  const email = clean(props.email);
  const at = submittedAt(props);
  if (!email || !at) return null;
  const name = [clean(props.firstname), clean(props.lastname)]
    .filter(Boolean)
    .join(" ");
  const fields: Record<string, string> = {};
  for (const [property, key] of Object.entries(FORM_FIELDS)) {
    const value = clean(props[property]);
    if (value) fields[key] = value;
  }
  return {
    contactId: raw.id,
    submittedAt: at,
    // One inbox row per contact per submission time.
    externalId: `${raw.id}:${at}`,
    payload: {
      email,
      ...(name ? { name } : {}),
      ...(clean(props.company) ? { company: clean(props.company) } : {}),
      ...(clean(props.country) ? { country: clean(props.country) } : {}),
      ...(clean(props.hs_timezone)
        ? { timezone: clean(props.hs_timezone) }
        : {}),
      ...(clean(props.message) ? { message: clean(props.message) } : {}),
      form_id: "hubspot-contact-sales",
      submitted_at: at,
      fields,
      crm_contact_id: raw.id,
      ...(crmRecordUrl(portalId, raw.id)
        ? { crm_url: crmRecordUrl(portalId, raw.id) }
        : {}),
    },
  };
}

/** The portal id, for record links. Null when the token cannot read it. */
export async function portalIdOf(fetch: HubSpotFetch): Promise<string | null> {
  try {
    const details = (await fetch("/account-info/v3/details")) as {
      portalId?: number | string;
    };
    return details.portalId ? String(details.portalId) : null;
  } catch {
    return null;
  }
}

export interface ContactSalesSearch {
  submissions: ContactSalesSubmission[];
  /** Contacts the date matched that are not Contact Sales, with why. */
  excluded: Array<{ externalId: string; reason: string }>;
}

/** Contacts whose most recent Contact Sales submission is on or after `since`. */
export async function searchContactSales(
  fetch: HubSpotFetch,
  input: { since: Date; limit: number; portalId?: string | null },
): Promise<ContactSalesSearch> {
  const out: ContactSalesSubmission[] = [];
  const excluded: ContactSalesSearch["excluded"] = [];
  let after: string | undefined;
  // The date property is day-granular, so filter from the start of that day.
  const sinceDay = new Date(
    Date.UTC(
      input.since.getUTCFullYear(),
      input.since.getUTCMonth(),
      input.since.getUTCDate(),
    ),
  );
  do {
    const page = (await fetch("/crm/v3/objects/contacts/search", {
      method: "POST",
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [
              {
                propertyName: "most_recent_contact_sales_date",
                operator: "GTE",
                value: String(sinceDay.getTime()),
              },
            ],
          },
        ],
        properties: [...CONTACT_SALES_PROPERTIES],
        sorts: [
          {
            propertyName: "most_recent_contact_sales_date",
            direction: "DESCENDING",
          },
        ],
        limit: Math.min(100, input.limit - out.length),
        ...(after ? { after } : {}),
      }),
    })) as {
      results?: Array<{ id: string; properties: Record<string, unknown> }>;
      paging?: { next?: { after?: string } };
    };
    for (const raw of page.results ?? []) {
      const submission = toSubmission(raw, input.portalId ?? null);
      if (!submission || new Date(submission.submittedAt) < input.since)
        continue;
      const check = isContactSales(raw.properties);
      if (check.ok) out.push(submission);
      else
        excluded.push({
          externalId: submission.externalId,
          reason: check.reason,
        });
    }
    after = page.paging?.next?.after;
  } while (after && out.length < input.limit);
  return { submissions: out, excluded };
}

/** Inserts new submissions; returns the inbox rows that are new. */
export async function enqueueSubmissions(
  repo: PaRepository,
  submissions: ContactSalesSubmission[],
  deps: { now: () => Date; newId: () => string },
): Promise<InboxRecord[]> {
  const created: InboxRecord[] = [];
  for (const submission of submissions) {
    const at = deps.now().toISOString();
    const { record, inserted } = await repo.insertInboxIfAbsent({
      id: deps.newId(),
      source: HUBSPOT_SOURCE,
      externalId: submission.externalId,
      receivedAt: at,
      signatureOk: true,
      payload: submission.payload,
      status: "pending",
      attempts: 0,
      lastError: null,
      nextAttemptAt: null,
      version: 1,
      createdAt: at,
      updatedAt: at,
    });
    if (inserted) created.push(record);
    else if (
      submission.payload.crm_url &&
      record.payload.crm_url !== submission.payload.crm_url
    ) {
      // Backfill the HubSpot link on rows pulled before it existed.
      await repo.updateInbox(
        record.id,
        {
          payload: { ...record.payload, crm_url: submission.payload.crm_url },
          updatedAt: at,
        },
        record.version,
      );
    }
  }
  return created;
}

/** Hides rows the date matched that turned out not to be Contact Sales. */
export async function excludeSubmissions(
  repo: PaRepository,
  excluded: ContactSalesSearch["excluded"],
  now: () => Date,
): Promise<number> {
  let count = 0;
  for (const item of excluded) {
    const row = await repo.getInboxBySource(HUBSPOT_SOURCE, item.externalId);
    if (!row || row.status === "skipped") continue;
    await repo.updateInbox(
      row.id,
      {
        status: "skipped",
        lastError: item.reason,
        updatedAt: now().toISOString(),
      },
      row.version,
    );
    count += 1;
  }
  return count;
}
