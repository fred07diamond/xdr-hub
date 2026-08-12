import { table, text, integer, now } from "@agent-native/core/db/schema";

// One row per user. Email is the primary key to match ctx.userEmail pattern.
export const userRoles = table("user_roles", {
  email: text("email").primaryKey(),
  role: text("role", { enum: ["xdr", "ae", "admin", "none"] })
    .notNull()
    .default("none"),
  hubspotAccountId: text("hubspot_account_id"),
  updatedAt: text("updated_at").default(now()),
});

// One row per workflow initiated by an XDR.
export const bookedMeetings = table("booked_meetings", {
  id: text("id").primaryKey(),
  // Nooks call that auto-created this meeting via webhook — idempotency key.
  nooksCallId: text("nooks_call_id"),
  prospectName: text("prospect_name").notNull(),
  company: text("company").notNull(),
  meetingDatetime: text("meeting_datetime"),
  prospectEmail: text("prospect_email"),
  aeUserEmail: text("ae_user_email").notNull().default(""),
  xdrUserEmail: text("xdr_user_email").notNull(),
  calendarEventId: text("calendar_event_id"),
  meetingLink: text("meeting_link"),
  status: text("status", { enum: ["pending", "confirmed", "cancelled"] })
    .notNull()
    .default("pending"),
  createdAt: text("created_at").default(now()),
});

// One row per workflow — holds the three AI-generated text outputs.
export const generatedNotes = table("generated_notes", {
  id: text("id").primaryKey(),
  meetingId: text("meeting_id").notNull(),
  xdrUserEmail: text("xdr_user_email").notNull(),
  meetingAgenda: text("meeting_agenda").notNull(),
  crmNotes: text("crm_notes").notNull(),
  xdrPain: text("xdr_pain").notNull().default(""),
  xdrEnterpriseNeed: text("xdr_enterprise_need").notNull().default(""),
  xdrContactQualification: text("xdr_contact_qualification").notNull().default(""),
  xdrNotes: text("xdr_notes").notNull().default(""),
  followUpEmail: text("follow_up_email").notNull(),
  emailSubject: text("email_subject").notNull().default(""),
  status: text("status", { enum: ["draft", "confirmed"] })
    .notNull()
    .default("draft"),
  createdAt: text("created_at").default(now()),
  confirmedAt: text("confirmed_at"),
});

// One row per HubSpot contact detected filling out the "Contact Sales" form,
// via the daily poll job (jobs/poll-hubspot-contact-sales.md). The idempotency
// key is (hubspotContactId, contactSalesDate) together, NOT hubspotContactId
// alone -- contactSalesDate tracks HubSpot's most_recent_contact_sales_date,
// which updates on every resubmission, so the same contact submitting again
// months later is a genuinely new lead and must be able to insert a second
// row with the new date. A plain unique() on hubspotContactId would silently
// block that forever after the first submission (see migration v18-v19).
export const inboundLeads = table("inbound_leads", {
  id: text("id").primaryKey(),
  hubspotContactId: text("hubspot_contact_id").notNull(),
  prospectName: text("prospect_name").notNull(),
  prospectEmail: text("prospect_email"),
  company: text("company"),
  contactSalesDate: text("contact_sales_date"),
  seen: integer("seen").notNull().default(0), // 0/1 boolean, matches the rest of this monorepo's convention
  createdAt: text("created_at").default(now()),
  // Populated by generate-lead-outreach -- null until an XDR actions the lead.
  qualificationTier: text("qualification_tier"),
  meetingAgenda: text("meeting_agenda"),
  xdrPain: text("xdr_pain"),
  xdrContactQualification: text("xdr_contact_qualification"),
  xdrNotes: text("xdr_notes"),
  crmNote: text("crm_note"),
  outreachEmail: text("outreach_email"),
  emailSubject: text("email_subject"),
  outreachGeneratedAt: text("outreach_generated_at"),
});

// One row per confirmed workflow — created after HubSpot deal creation succeeds.
export const deals = table("deals", {
  id: text("id").primaryKey(),
  meetingId: text("meeting_id").notNull(),
  dealName: text("deal_name").notNull(),
  associatedContact: text("associated_contact").notNull(),
  company: text("company").notNull(),
  aeOwnerEmail: text("ae_owner_email").notNull(),
  hubspotDealId: text("hubspot_deal_id"),
  createdAt: text("created_at").default(now()),
});
