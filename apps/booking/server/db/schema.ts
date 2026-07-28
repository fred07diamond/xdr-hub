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
