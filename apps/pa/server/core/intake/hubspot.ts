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
  "jobtitle",
  "message",
  "what_is_your_use_case__contact_sales_",
  "current_tech_stack__contact_sales_questionnaire_",
  "budget_status_for_dev_tools_this_year_",
  "what_is_your_company_size_",
  "company_fit_score___breeze",
  "most_recent_contact_sales_date",
  "most_recently_contact_sales_date__date_time_",
] as const;

/** Form answers kept on the submission, under readable keys. */
const FORM_FIELDS: Record<string, string> = {
  what_is_your_use_case__contact_sales_: "use_case",
  current_tech_stack__contact_sales_questionnaire_: "tech_stack",
  budget_status_for_dev_tools_this_year_: "budget_status",
  what_is_your_company_size_: "company_size",
  company_fit_score___breeze: "breeze_fit_score",
  jobtitle: "job_title",
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

export function toSubmission(raw: {
  id: string;
  properties: Record<string, unknown>;
}): ContactSalesSubmission | null {
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
      ...(clean(props.message) ? { message: clean(props.message) } : {}),
      form_id: "hubspot-contact-sales",
      submitted_at: at,
      fields,
      crm_contact_id: raw.id,
    },
  };
}

/** Contacts whose most recent Contact Sales submission is on or after `since`. */
export async function searchContactSales(
  fetch: HubSpotFetch,
  input: { since: Date; limit: number },
): Promise<ContactSalesSubmission[]> {
  const out: ContactSalesSubmission[] = [];
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
      const submission = toSubmission(raw);
      if (submission && new Date(submission.submittedAt) >= input.since)
        out.push(submission);
    }
    after = page.paging?.next?.after;
  } while (after && out.length < input.limit);
  return out;
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
  }
  return created;
}
