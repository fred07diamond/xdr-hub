import { table, text, integer, now } from "@agent-native/core/db/schema";

// LEGACY / frozen. Persona data now lives in packages/shared's sharedPersonas
// (getSharedDb, @xdr-hub/shared/server) -- every action reads/writes there.
// This table is kept only so historical rows (prospects.personaId,
// leadListItems.personaId, postEngagements.personaId) still resolve; those
// FK repoints are a deferred follow-up. Do not add new writers here.
export const icpPersonas = table("icp_personas", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#6366f1"),
  icpText: text("icp_text"),
  summary: text("summary"),
  isActive: integer("is_active").notNull().default(0),
  // Generated persona briefing (titles to target, voice, why they buy, org
  // priorities) as a JSON PersonaBriefing -- see server/helpers/persona-
  // briefing.ts. A derived READ of icpText for the rep to look at; nothing
  // scores or drafts from it. briefingSourceHash is the fingerprint of the
  // icpText it came from, so adding or removing a document marks the briefing
  // stale instead of silently serving one that no longer matches the criteria.
  briefing: text("briefing"),
  briefingGeneratedAt: text("briefing_generated_at"),
  briefingSourceHash: text("briefing_source_hash"),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
});

// LEGACY / frozen, same as icpPersonas above. Persona documents now live in
// packages/shared's sharedPersonaDocs; criteria text is computed fresh via
// getPersonaCriteriaText, never cached on a column. Kept only for historical
// reference -- do not add new writers here.
export const icpPersonaDocs = table("icp_persona_docs", {
  id: text("id").primaryKey(),
  personaId: text("persona_id").notNull(),
  name: text("name").notNull(),
  text: text("text").notNull(),
  wordCount: integer("word_count").notNull().default(0),
  // Explicit ordering so the concatenated icpText is stable and the UI list
  // matches the order the agent actually reads the docs in. createdAt alone
  // isn't enough -- a multi-file upload writes every doc in the same tick.
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").default(now()),
});

// Personal API tokens — one per user, used by the extension to identify callers.
export const apiTokens = table("api_tokens", {
  id: text("id").primaryKey(),
  userEmail: text("user_email").notNull(),
  token: text("token").notNull(),
  createdAt: text("created_at").default(now()),
});

// One row per LinkedIn profile the extension has ever captured, per user.
// Status lifecycle: captured → drafted → sent
export const prospects = table("prospects", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email"),
  profileUrl: text("profile_url").notNull(),
  name: text("name"),
  headline: text("headline"),
  role: text("role"),
  company: text("company"),
  about: text("about"),
  recentActivity: text("recent_activity"),
  fitVerdict: text("fit_verdict", { enum: ["strong", "possible", "weak", "inconclusive"] }),
  fitScore: integer("fit_score"),
  scoreRoleFit: integer("score_role_fit"),
  scoreSeniority: integer("score_seniority"),
  scoreCompanyFit: integer("score_company_fit"),
  scoreIntent: integer("score_intent"),
  intentSignal: text("intent_signal"),
  scoredAtVersion: text("scored_at_version"),
  fitReason: text("fit_reason"),
  draftNote: text("draft_note"),
  draftFollowUp: text("draft_follow_up"),
  personaId: text("persona_id"),
  personaName: text("persona_name"),
  personaColor: text("persona_color"),
  rating: integer("rating"),       // 1 = thumbs up, -1 = thumbs down
  ratingNote: text("rating_note"),
  status: text("status", { enum: ["captured", "drafted", "sent"] })
    .notNull()
    .default("captured"),
  // Apollo.io enrichment — on-demand, triggered from the Prospects table
  // (enrich-prospect.ts). Same shape as lead_list_items' enrichment columns.
  enrichmentStatus: text("enrichment_status", { enum: ["idle", "enriching", "done", "not_found", "failed"] })
    .notNull()
    .default("idle"),
  enrichedEmail: text("enriched_email"),
  enrichedTitle: text("enriched_title"),
  enrichedPhone: text("enriched_phone"),
  enrichedLinkedinUrl: text("enriched_linkedin_url"),
  enrichedCompanyIndustry: text("enriched_company_industry"),
  enrichedCompanySize: integer("enriched_company_size"),
  // Apollo's person.organization.primary_domain -- was already being read at
  // enrich time (as a lookup key for enrichApolloOrganization) but never
  // persisted. Used to key company search (HubSpot, Clearbit logo) more
  // reliably than free-text company name.
  companyDomain: text("company_domain"),
  enrichedAt: text("enriched_at"),
  enrichmentError: text("enrichment_error"),
  // Provenance -- which write path produced the current enrichment values,
  // and Apollo's own confidence in the email it matched. email_status comes
  // back on every /people/match response but was previously discarded.
  enrichmentSource: text("enrichment_source", { enum: ["apollo", "apollo_phone_reveal"] }),
  enrichedEmailStatus: text("enriched_email_status"),
  // Apollo's reveal_phone_number flow -- async, delivered via webhook, not
  // part of the synchronous /people/match response. phoneRevealRequestId is
  // Apollo's request_id, captured from the initial reveal request and used
  // by apollo-phone-reveal-webhook.ts to match the later callback back to
  // this row. Spends real Apollo credits, so only requested when
  // enrichedPhone is empty at enrich time.
  phoneRevealStatus: text("phone_reveal_status", { enum: ["requested", "done", "no_match", "failed"] }),
  phoneRevealRequestId: text("phone_reveal_request_id"),
  phoneRevealRequestedAt: text("phone_reveal_requested_at"),
  // Who spent the 8 credits, and whether they overrode the fit gate to do it.
  phoneRevealRequestedBy: text("phone_reveal_requested_by"),
  phoneRevealOverride: integer("phone_reveal_override").notNull().default(0),
  phoneRevealOverrideAt: text("phone_reveal_override_at"),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
});

// User-created tags for labeling prospects -- replaces the old fixed
// captured/drafted/sent status column on the Prospects table with something
// the user defines themselves. Prospects-only, same scope as
// note/rating/mark-sent (see AGENTS.md's Lead Lists section): a lead list
// item has to be promoted into a real prospects row (via
// score-lead-list-item.ts or capture-profile.ts) before it can be tagged.
export const prospectTags = table("prospect_tags", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email"),
  name: text("name").notNull(),
  color: text("color").notNull().default("#6366f1"),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
});

// Many-to-many join between prospects and prospectTags.
export const prospectTagLinks = table("prospect_tag_links", {
  id: text("id").primaryKey(),
  prospectId: text("prospect_id").notNull(),
  tagId: text("tag_id").notNull(),
  createdAt: text("created_at").default(now()),
});

// One row per manual send — written by mark-sent, read by check-already-contacted.
export const sendHistory = table("send_history", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email"),
  profileUrl: text("profile_url").notNull(),
  sentAt: text("sent_at").default(now()),
});

// User-submitted feedback messages.
export const feedback = table("feedback", {
  id: text("id").primaryKey(),
  userEmail: text("user_email"),
  sentiment: text("sentiment"),   // "positive" | "negative" | null
  message: text("message").notNull(),
  draftNote: text("draft_note"),  // the connection note the user rated
  createdAt: text("created_at").default(now()),
  resolvedAt: text("resolved_at"), // null = active; set to ISO string when resolved
});

// Admin-controlled workspace settings (key-value store).
export const workspaceSettings = table("workspace_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: text("updated_at").default(now()),
});

// ── Apollo credit accounting ────────────────────────────────────────────────
// Apollo bills per unit of data: 1 credit for a person match (which is what
// yields an email) and 8 for a phone reveal. This app is one of three tools
// drawing on a shared allocation, so it enforces a self-imposed cap on its own
// share -- see server/helpers/apollo-credits/.

// Append-only log, ONE ROW PER CREDIT-BEARING UNIT (a match that also requests
// a reveal writes two rows: 1 credit + 8 credits).
//
// Why this exists rather than deriving spend from the enrichment columns the
// way actions/list-enrichment-audit-log.ts does: that report reads CURRENT ROW
// STATE, so it cannot see a second or third re-enrich of the same lead
// (enrichedAt is overwritten each time), cannot see calls that errored or were
// voided, has no record of whether a human or the background sweep triggered
// the spend, and -- per its own comment -- shows one Apollo call twice when a
// lead has been promoted into prospects. All four are disqualifying for a
// budget. That action stays as the "who has contact data" report; this table is
// the "what did we actually pay" record.
export const apolloCreditLedger = table("apollo_credit_ledger", {
  id: text("id").primaryKey(),
  unit: text("unit", { enum: ["person_match", "phone_reveal", "org_enrich"] }).notNull(),
  // What we charge against the budget at call time. Authoritative until (and
  // unless) the webhook tells us otherwise.
  estimatedCredits: integer("estimated_credits").notNull(),
  // Apollo's own number, from the phone-reveal webhook's `credits_consumed`.
  // Null until reconciled -- every budget sum reads
  // COALESCE(actual, estimated), so a webhook reporting 0 refunds the budget
  // with no separate refund code path.
  actualCredits: integer("actual_credits"),
  status: text("status", {
    enum: ["reserved", "committed", "pending_webhook", "reconciled", "voided"],
  }).notNull(),
  // Canonical period key (YYYY-MM-DD of the anchor date), denormalized rather
  // than recomputed at query time for two reasons: the period sum becomes one
  // indexed equality scan, and it FREEZES attribution -- if an admin later
  // changes the anchor day, historical rows keep the period they were charged
  // in instead of silently migrating between buckets.
  periodStart: text("period_start").notNull(),
  subjectTable: text("subject_table", { enum: ["lead_list_items", "prospects"] }),
  subjectId: text("subject_id"),
  // Null for the background sweep, which spends on nobody's personal budget.
  actorEmail: text("actor_email"),
  trigger: text("trigger", { enum: ["manual", "sweep", "agent"] }).notNull(),
  // The lead's fit verdict AT SPEND TIME. This is what makes "how many credits
  // did we burn on weak leads" answerable, which is the whole point of gating.
  // Recorded here rather than joined at read time because the lead's verdict
  // can be regenerated later, and that must not rewrite history.
  fitVerdict: text("fit_verdict", { enum: ["strong", "possible", "weak", "inconclusive"] }),
  // 1 when a user explicitly overrode the fit gate to spend 8 credits on a
  // lead that did not qualify. The number an admin watches to tell whether the
  // gate is working.
  isOverride: integer("is_override").notNull().default(0),
  // Apollo's own person id -- the join key the async reveal webhook matches on.
  // Deliberately matched against THIS table rather than against the lead row,
  // because score-lead-list-item.ts copies phoneRevealRequestId onto the
  // promoted prospects row, so one Apollo person id legitimately exists on two
  // records.
  apolloPersonId: text("apollo_person_id"),
  outcome: text("outcome"),
  note: text("note"),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
});

// Per-user credit allowance. An ABSENT row means "inherit the workspace
// default" (apollo_user_default_credit_limit) -- storing the default per user
// would mean a later change to it silently skipped everyone already listed.
export const apolloUserCreditLimits = table("apollo_user_credit_limits", {
  userEmail: text("user_email").primaryKey(),
  creditLimit: integer("credit_limit").notNull(),
  updatedAt: text("updated_at").default(now()),
});

// One row per (period, threshold) that has already been announced, so an
// admin is told once per period that credits are running low rather than on
// every subsequent spend.
//
// The composite natural key IS the primary key on purpose: that makes
// `insert(...).onConflictDoNothing()` the entire dedupe mechanism, with no
// read-then-write race between concurrent serverless instances. And because
// periodStart is part of the key, a new period re-arms every threshold with no
// reset job -- which matters because this app has no reliable scheduler.
export const apolloCreditThresholdNotices = table("apollo_credit_threshold_notices", {
  // `${periodStart}|${threshold}`
  id: text("id").primaryKey(),
  periodStart: text("period_start").notNull(),
  threshold: integer("threshold").notNull(),
  firedAt: text("fired_at").default(now()),
  spentAtFire: integer("spent_at_fire"),
  // Claim token: whichever process wrote the row wins and sends the notice.
  // Compared after insert instead of relying on affected-row counts, which are
  // not portable across SQLite and Postgres.
  noticeRunId: text("notice_run_id"),
});

// Seen phone-reveal webhook payloads, keyed by a hash of the raw body, so an
// at-least-once redelivery cannot double-reconcile a credit. The existing
// phone-number write happens to be idempotent by accident; credit
// reconciliation would not be.
export const apolloWebhookDeliveries = table("apollo_webhook_deliveries", {
  // sha256 hex of the raw request body
  id: text("id").primaryKey(),
  receivedAt: text("received_at").default(now()),
  creditsConsumed: integer("credits_consumed"),
  apolloPersonIds: text("apollo_person_ids"),
});

// Canvas nodes for the Messaging tab.
// type='persona' nodes are shared (owner_email=null); all other types are per-user.
export const messagingNodes = table("messaging_nodes", {
  id: text("id").primaryKey(),
  type: text("type").notNull().default("user"),
  title: text("title").notNull().default("New Node"),
  ownerEmail: text("owner_email"),
  canvasId: text("canvas_id"),
  personaId: text("persona_id"),
  tone: text("tone"),
  valueProps: text("value_props"),
  phrasesToUse: text("phrases_to_use"),
  phrasesToAvoid: text("phrases_to_avoid"),
  exampleNotes: text("example_notes"),
  notes: text("notes"),
  // Set on hubspot_reference nodes so a future "Refresh" can re-pull without re-searching.
  hubspotContactId: text("hubspot_contact_id"),
  positionX: integer("position_x").notNull().default(100),
  positionY: integer("position_y").notNull().default(100),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
});

// Directed edges between messaging nodes (source → target = parent → child).
// owner_email scopes each edge to the user who created it.
export const messagingEdges = table("messaging_edges", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull(),
  targetId: text("target_id").notNull(),
  ownerEmail: text("owner_email"),
  canvasId: text("canvas_id"),
  createdAt: text("created_at").default(now()),
});

// Named messaging canvases. System templates have is_system=1 and no owner_email.
// User-created canvases are scoped by owner_email.
export const messagingCanvases = table("messaging_canvases", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  templateSlug: text("template_slug"),      // "account" | "role" | "prospect" | "blank" | null
  isSystem: integer("is_system").notNull().default(0),
  ownerEmail: text("owner_email"),           // null for system templates
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
});

// HubSpot outreach queues — each queue mirrors one HubSpot contact list.
export const hubspotQueues = table("hubspot_queues", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  name: text("name").notNull(),
  hubspotListId: text("hubspot_list_id").notNull(),
  hubspotListName: text("hubspot_list_name").notNull(),
  status: text("status", { enum: ["active", "done"] }).notNull().default("active"),
  totalCount: integer("total_count").notNull().default(0),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
});

// Individual contacts within a HubSpot queue.
export const hubspotQueueItems = table("hubspot_queue_items", {
  id: text("id").primaryKey(),
  queueId: text("queue_id").notNull(),
  hubspotContactId: text("hubspot_contact_id").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  email: text("email"),
  company: text("company"),
  jobTitle: text("job_title"),
  linkedinUrl: text("linkedin_url"),
  status: text("status", { enum: ["pending", "visited", "skipped"] }).notNull().default("pending"),
  position: integer("position").notNull(),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
});

// Sales Navigator lead lists imported by the extension — each import creates
// a new list entity (same behavior as HubSpot queues re-importing a list,
// verified against import-hubspot-queue.ts, which has no upsert/merge logic).
// ownerEmail is nullable, unlike hubspotQueues.ownerEmail, because this is
// written by a public/unauthenticated action (resolveOwner() can return
// null) — same nullable-owner shape as prospects/postEngagements.
// Shallow import only: no ICP scoring or draft note happens here. That still
// happens later, per-lead, through the existing capture-profile flow when
// the xDR opens that lead's actual profile page.
export const leadLists = table("lead_lists", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email"),
  name: text("name").notNull(),
  description: text("description"),
  salesNavListUrl: text("sales_nav_list_url"),
  totalCount: integer("total_count").notNull().default(0),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
});

// Individual leads within a Sales Navigator lead list. profileUrl (the
// public /in/... URL) is null at import time — a list page has N leads, so
// there's no reliable single-link scan to resolve it the way a single lead's
// profile page can. It gets filled in later once the xDR actually opens that
// lead's profile and the existing capture flow runs. salesNavLeadUrl (the
// /sales/lead/... link) is always present at import time and is what "Open
// LinkedIn" falls back to until profileUrl is resolved.
// SCORE-FIRST PIPELINE
//
// fitVerdict/fitReason/draftNote/draftFollowUp/scoredAt used to exist only on
// the promoted prospects row, which meant the sweep had to spend an Apollo
// credit before it could know whether a lead deserved one. Scoring is LLM-only
// and costs zero Apollo credits, so it now runs first and lands here -- which
// is also the first time the Lead Lists page has any fit signal to show.
//
// pipelineStage is deliberately separate from enrichmentStatus. That column
// keeps meaning exactly what it means today: the outcome of an Apollo lookup.
// Overloading it with a "skipped" value would put phantom rows in the
// enrichment audit export for leads Apollo was never called on, and would
// change the meaning of both the ne(enrichmentStatus, "idle") filter in
// list-enrichment-audit-log.ts and the Analytics funnel.
//
// HOUSEKEEPING, learned the hard way: keep comments INSIDE this table body
// short, and prefer no apostrophes. The framework db-tool-scoping guard locates
// a table body by brace-matching, and it tracks string literals while NOT
// skipping comments -- so an apostrophe in a body comment flips it into
// "inside a string" state. Depending on where that lands relative to the
// nested { enum: [...] } braces below, the brace count desynchronizes, the
// body is read as extending into a later table that does have owner_email,
// and this table gets reported as a stale dbToolScopingDenylist entry, which
// FAILS THE PRODUCTION BUILD with a message that points nowhere near the real
// cause. Long prose belongs here, above the table, where it cannot interfere.
export const leadListItems = table("lead_list_items", {
  id: text("id").primaryKey(),
  listId: text("list_id").notNull(),
  name: text("name"),
  headline: text("headline"),
  company: text("company"),
  location: text("location"),
  profileUrl: text("profile_url"),
  salesNavLeadUrl: text("sales_nav_lead_url"),
  status: text("status", { enum: ["pending", "visited", "skipped"] }).notNull().default("pending"),
  position: integer("position").notNull(),
  // Persona assigned from the scraped headline/title at import time via
  // selectPersonasBatch() — same personaId/personaName/personaColor shape as
  // prospects. Best-effort: null when there's no headline yet, or when the
  // batch classification call fails.
  personaId: text("persona_id"),
  personaName: text("persona_name"),
  personaColor: text("persona_color"),
  // Apollo.io enrichment — on-demand, triggered from the Lead Lists page
  // (enrich-lead-list-item.ts), not part of the shallow import above.
  // enrichedLinkedinUrl is kept separate from profileUrl, which stays
  // reserved for the value the capture-profile flow resolves when the xDR
  // actually opens the lead's LinkedIn page (see comment above).
  enrichmentStatus: text("enrichment_status", { enum: ["idle", "enriching", "done", "not_found", "failed"] })
    .notNull()
    .default("idle"),
  enrichedEmail: text("enriched_email"),
  enrichedTitle: text("enriched_title"),
  enrichedPhone: text("enriched_phone"),
  enrichedLinkedinUrl: text("enriched_linkedin_url"),
  enrichedCompanyIndustry: text("enriched_company_industry"),
  enrichedCompanySize: integer("enriched_company_size"),
  // Same as prospects.companyDomain -- Apollo's person.organization.primary_domain.
  companyDomain: text("company_domain"),
  enrichedAt: text("enriched_at"),
  // Per-endpoint Apollo warnings (e.g. a key scoped for org search but not
  // person match) — set whenever the person and/or organization lookup
  // threw, even if the other one succeeded, so a partial "done" result is
  // still explainable instead of looking like silent data loss.
  enrichmentError: text("enrichment_error"),
  // Provenance -- same shape as prospects' enrichmentSource/enrichedEmailStatus.
  enrichmentSource: text("enrichment_source", { enum: ["apollo", "apollo_phone_reveal"] }),
  enrichedEmailStatus: text("enriched_email_status"),
  // Apollo's reveal_phone_number flow -- async, delivered via webhook, not
  // part of the synchronous /people/match response. phoneRevealRequestId is
  // Apollo's request_id, captured from the initial reveal request and used
  // by apollo-phone-reveal-webhook.ts to match the later callback back to
  // this row. Spends real Apollo credits, so only requested when
  // enrichedPhone is empty at enrich time.
  phoneRevealStatus: text("phone_reveal_status", { enum: ["requested", "done", "no_match", "failed"] }),
  phoneRevealRequestId: text("phone_reveal_request_id"),
  phoneRevealRequestedAt: text("phone_reveal_requested_at"),
  // Opt-in flag for the automatic enrich+score+draft background pipeline
  // (server/helpers/lead-pipeline-sweep.ts). Only set true by
  // import-sales-nav-list.ts going forward -- pre-existing rows imported
  // before this shipped stay false/excluded, so shipping this doesn't
  // suddenly auto-enrich the entire historical backlog (real Apollo/LLM
  // cost spike for leads nobody decided to act on).
  autoEnrich: integer("auto_enrich").notNull().default(0),
  // Poison-lead guard for the sweep's atomic claim step -- capped at 3
  // attempts, then the lead is marked enrichmentStatus "failed" instead of
  // being retried forever.
  pipelineAttempts: integer("pipeline_attempts").notNull().default(0),
  // Set once this lead has been scored, drafted, and upserted into
  // `prospects` by the automatic pipeline. Lets the sweep skip already-done
  // rows and lets the UI show "in Prospects" instead of the enrich badges.
  // ── Score-first pipeline (see the note above the table) ─────────────────
  fitVerdict: text("fit_verdict", { enum: ["strong", "possible", "weak", "inconclusive"] }),
  fitScore: integer("fit_score"),
  scoreRoleFit: integer("score_role_fit"),
  scoreSeniority: integer("score_seniority"),
  scoreCompanyFit: integer("score_company_fit"),
  scoreIntent: integer("score_intent"),
  intentSignal: text("intent_signal"),
  scoredAtVersion: text("scored_at_version"),
  fitReason: text("fit_reason"),
  draftNote: text("draft_note"),
  draftFollowUp: text("draft_follow_up"),
  scoredAt: text("scored_at"),
  // Separate from enrichmentStatus on purpose -- see the note above the table.
  pipelineStage: text("pipeline_stage", {
    enum: ["queued", "scoring", "scored", "enriching", "promoting", "done", "blocked", "failed"],
  })
    .notNull()
    .default("queued"),
  // avoid_title / below_quality_bar / budget. Not terminal.
  pipelineBlockedReason: text("pipeline_blocked_reason"),
  // Who spent the 8 credits, and whether the fit gate was overridden.
  phoneRevealRequestedBy: text("phone_reveal_requested_by"),
  phoneRevealOverride: integer("phone_reveal_override").notNull().default(0),
  phoneRevealOverrideAt: text("phone_reveal_override_at"),
  promotedProspectId: text("promoted_prospect_id"),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
});

// Singleton row that holds ICP configuration.
// icpText: the full text of the user's uploaded ICP document — used by
//   capture-profile to score and draft every captured LinkedIn profile.
// sources: legacy Notion page IDs array, kept for backward compatibility.
export const icpSources = table("icp_sources", {
  id: text("id").primaryKey().default("singleton"),
  sources: text("sources").notNull().default("[]"),
  icpText: text("icp_text"),
  updatedAt: text("updated_at").default(now()),
});

// Post engagements — one row per LinkedIn post comment that has been processed.
// Status lifecycle: pending → enriching → scoring → done
export const postEngagements = table("post_engagements", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email"),
  postUrl: text("post_url").notNull(),
  postTitle: text("post_title"),
  engagerName: text("engager_name").notNull(),
  engagerCompany: text("engager_company"),
  engagerHeadline: text("engager_headline"),
  engagerRole: text("engager_role"),
  engagerAbout: text("engager_about"),
  engagerRecentActivity: text("engager_recent_activity"),
  engagerProfileUrl: text("engager_profile_url").notNull(),
  commentText: text("comment_text"),
  xdrOwner: text("xdr_owner"),
  contactOwner: text("contact_owner"),
  companyOwner: text("company_owner"),
  hubspotStatus: text("hubspot_status", { enum: ["found", "new_opportunity"] }),
  hubspotContactUrl: text("hubspot_contact_url"),
  fitVerdict: text("fit_verdict", { enum: ["strong", "possible", "weak", "inconclusive"] }),
  fitReason: text("fit_reason"),
  draftNote: text("draft_note"),
  personaId: text("persona_id"),
  personaName: text("persona_name"),
  personaColor: text("persona_color"),
  status: text("status", { enum: ["pending", "enriching", "scoring", "done"] })
    .notNull()
    .default("pending"),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
});

// Fixed-window rate-limit counters. One row per (bucket, action) pair; the
// window resets whenever a check finds windowStart older than the window size.
export const rateLimitCounters = table("rate_limit_counters", {
  id: text("id").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: text("window_start").notNull(),
});

// Lifetime, append-only counter of leads ever added per owner. Analytics'
// "Leads" metric must show all-time leads added by the XDR -- it can't be
// backed by a live leadListItems count() or leadLists.totalCount, both of
// which shrink whenever leads are later cleaned up or deleted (delete-lead-
// list, bulk-delete-lead-list-items, the leadListItems cleanup inside
// bulk-delete-prospects/delete-prospect). One row per ownerEmail (including
// one row for null/anonymous), incremented via incrementLeadCounter() at
// every leadListItems insertion site, never decremented.
export const leadCounters = table("lead_counters", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email"),
  totalLeadsAdded: integer("total_leads_added").notNull().default(0),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
});
