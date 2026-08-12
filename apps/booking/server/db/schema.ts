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
// via the 2-hourly poll job (jobs/poll-hubspot-contact-sales.md). The idempotency
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

  // Checkpoint 1 output -- populated by run-intro-call-checkpoint (the
  // "Action lead" button). Null until an xDR actions the lead. Facts
  // (contact/company/deals, Enterprise Need, ICP Fit) are deterministic --
  // stored as structured fields/JSON so the UI renders a scannable fact
  // grid and scorecard, not paragraphs the xDR has to read. Only the
  // judgment calls (tldr, pain, champion, recommendation) come from the LLM.
  introTldr: text("intro_tldr"),
  introResearchJson: text("intro_research_json"), // JSON.stringify(IntroCallResearch)
  introProduct: text("intro_product", { enum: ["content", "code"] }),
  introProductSignal: text("intro_product_signal"),
  introEnterpriseNeedScore: integer("intro_enterprise_need_score"),
  introEnterpriseNeedLabel: text("intro_enterprise_need_label"),
  introEnterpriseNeedSignals: text("intro_enterprise_need_signals"), // JSON string[]
  introIcpFitScore: integer("intro_icp_fit_score"),
  introIcpFitLabel: text("intro_icp_fit_label"),
  introIcpFitSignals: text("intro_icp_fit_signals"), // JSON string[]
  introMaturityStage: integer("intro_maturity_stage"),
  introMaturityStageReason: text("intro_maturity_stage_reason"),
  introPainScore: integer("intro_pain_score"),
  introPainLabel: text("intro_pain_label"),
  introPainRationale: text("intro_pain_rationale"),
  introChampionScore: integer("intro_champion_score"),
  introChampionLabel: text("intro_champion_label"),
  introChampionRationale: text("intro_champion_rationale"),
  introRecommendation: text("intro_recommendation", { enum: ["take_call", "pivot_ae", "disqualify"] }),
  introRecommendationRationale: text("intro_recommendation_rationale"),
  introCheckpointGeneratedAt: text("intro_checkpoint_generated_at"),

  // Decision + branch output -- populated by decide-intro-call, once the xDR
  // picks one of the three buttons on the checkpoint output.
  introDecision: text("intro_decision", { enum: ["take_call", "pivot_ae", "disqualify"] }),
  introOutputSubject: text("intro_output_subject"),
  introOutputBody: text("intro_output_body"),
  introAeName: text("intro_ae_name"),
  introAeEmail: text("intro_ae_email"),
  introTimeWorks: integer("intro_time_works"), // 0/1, only set for pivot_ae
  introAltTime1: text("intro_alt_time_1"),
  introAltTime2: text("intro_alt_time_2"),
  introDecisionGeneratedAt: text("intro_decision_generated_at"),

  // Live-call worksheet -- populated by generate-intro-call-worksheet, only
  // reachable after introDecision = take_call.
  introWorksheet: text("intro_worksheet"),
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
