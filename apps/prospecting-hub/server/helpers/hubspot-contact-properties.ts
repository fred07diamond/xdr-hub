// Shared contact-properties list for anything that pulls HubSpot contacts
// into this app's `contacts` table — sync-hubspot.ts (on-demand pull) and
// hubspot-contact-search.ts (Marketing-rule pipeline's filtered search) both
// need to write the same set of fields onto the same `contacts` row shape,
// so keeping one shared list here means they can't silently drift apart.
export const HUBSPOT_CONTACT_PROPERTIES = [
  "firstname",
  "lastname",
  "jobtitle",
  "company",
  "email",
  "phone",
  "hs_linkedin_url",
  "ql_score",
  "company_fit_score___breeze",
  "lifecyclestage",
];

export interface HubSpotContactProperties {
  firstname?: string;
  lastname?: string;
  jobtitle?: string;
  company?: string;
  email?: string;
  phone?: string;
  hs_linkedin_url?: string;
  ql_score?: string;
  company_fit_score___breeze?: string;
  lifecyclestage?: string;
}

export interface HubSpotContactRecord {
  id: string;
  properties: HubSpotContactProperties;
}

// Never-sequenced/pre-qualification HubSpot lifecycle stages, per Fred's
// explicit call — this portal's actual funnel is RAW -> MEL -> QL -> SAL ->
// S0 -> S1 -> Closed, plus terminal Recycle/Excluded/Disqualified. QL
// ("Qualified Lead") is included; SAL and later are excluded — already
// handed off past prospecting. Used by create-marketing-rule.ts as the
// default when a rule doesn't override it, and by run-marketing-rule-
// pipeline.ts as a defensive fallback for a rule row with no
// lifecycleStages set at all.
export const DEFAULT_LIFECYCLE_STAGES = ["RAW", "MEL", "QL"];
